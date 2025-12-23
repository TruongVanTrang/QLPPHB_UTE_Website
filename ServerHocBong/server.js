const express = require('express');
const sql = require('mssql/msnodesqlv8'); 
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json()); 

// CẤU HÌNH KẾT NỐI
const config = {
    connectionString: 'Driver={ODBC Driver 17 for SQL Server};Server=DESKTOP-TGHEQS6;Database=QLHocBongUTE;Trusted_Connection=yes;'
};

async function connectDB() {
    try {
        await sql.connect(config);
        console.log("✅ Đã kết nối SQL Server thành công!");
    } catch (err) {
        console.log("❌ Lỗi kết nối:", err.message);
    }
}
connectDB();

// =============================================================
// 1. HỌC BỔNG KHUYẾN KHÍCH
// =============================================================
app.get('/api/xetduyet-hbkk', async (req, res) => {
    try {
        // Lấy tham số từ Client (mặc định HK2 nếu không gửi)
        let maHK = req.query.maHK || 'HK2'; 
        let maKhoa = req.query.maKhoa ? req.query.maKhoa.trim() : ""; 
        let loaiHB = req.query.loaiHB; 

        console.log(`🔍 HBKK: HK=[${maHK}], Khoa=[${maKhoa}], Loại=[${loaiHB}]`);

        // Query cơ bản
        let sqlQuery = `
            SELECT 
                sv.MaSV, sv.HoTen, l.TenLop, RTRIM(l.MaKhoa) as MaKhoa,
                g.GPA, d.DiemRL, 
                -- Tính tổng điểm hoạt động đã duyệt
                ISNULL((SELECT SUM(DiemChot) FROM DiemHoatDong hd 
                        WHERE hd.MaSV = sv.MaSV AND hd.MaHK = '${maHK}' AND hd.TrangThai = N'Đạt'), 0) as DiemHD,
                N'Đủ điều kiện' as GhiChuSystem
            FROM SinhVien sv
            JOIN Lop l ON sv.MaLop = l.MaLop
            JOIN GPA_SinhVien g ON sv.MaSV = g.MaSV
            JOIN DiemRenLuyen d ON sv.MaSV = d.MaSV
            WHERE g.MaHK = '${maHK}' 
              AND d.MaHK = '${maHK}' -- [FIX] Thêm điều kiện HK cho ĐRL
              AND d.DiemRL >= 70
        `;

        // Filter Loại A/B (Hardcode tạm thời theo logic phổ biến)
        if (loaiHB === 'A') {
            sqlQuery += ` AND g.GPA >= 3.6 `;
        } else if (loaiHB === 'B') {
            sqlQuery += ` AND g.GPA >= 3.2 AND g.GPA < 3.6 `;
        } else {
            sqlQuery += ` AND g.GPA >= 3.2 `;
        }

        // Filter Khoa
        if (maKhoa && maKhoa !== 'null' && maKhoa !== '') {
            sqlQuery += ` AND RTRIM(l.MaKhoa) = '${maKhoa}' `; 
        }

        sqlQuery += ` ORDER BY g.GPA DESC, d.DiemRL DESC`; // [FIX] Sắp xếp thêm theo ĐRL

        let result = await sql.query(sqlQuery);
        res.json(result.recordset);

    } catch (err) {
        console.log("❌ Lỗi HBKK:", err.message); 
        res.status(500).send(err.message);
    }
});

// API Lấy Khoa
app.get('/api/khoa', async (req, res) => {
    try {
        let result = await sql.query('SELECT * FROM Khoa');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).send(err.message);
    }
});


// =============================================================
// 2. HỌC BỔNG THỬ THÁCH
// =============================================================
app.get('/api/xetduyet-hbtt', async (req, res) => {
    try {
        let namHoc = req.query.namHoc || '2024-2025'; 
        console.log(`🔍 HBTT: Năm học=[${namHoc}]`);

        let query = `
            SELECT 
                tt.MaSV, sv.HoTen, l.TenLop,
                tt.NamHoc, tt.MaTieuChi,
                tt.DiemGPA_Nam, tt.DiemRL_Nam, 
                tt.LinkMinhChung, 
                tt.DiemTuDanhGia, 
                ISNULL(tt.DiemThamDinh, tt.DiemTuDanhGia) as DiemThamDinh, 
                ISNULL(tt.TrangThai, N'Chờ duyệt') as TrangThai
            FROM HB_ThuThach tt
            JOIN SinhVien sv ON tt.MaSV = sv.MaSV
            JOIN Lop l ON sv.MaLop = l.MaLop
            WHERE tt.NamHoc = '${namHoc}'
            ORDER BY 
                CASE WHEN tt.TrangThai = N'Chờ duyệt' THEN 0 ELSE 1 END,
                tt.DiemGPA_Nam DESC
        `;

        let result = await sql.query(query);
        res.json(result.recordset);
    } catch (err) {
        console.log("❌ Lỗi HBTT:", err.message);
        res.status(500).send(err.message);
    }
});

app.post('/api/duyet-hbtt', async (req, res) => {
    try {
        let { maSV, namHoc, maTieuChi, diemThamDinh, trangThai, ghiChu } = req.body;
        console.log(`👉 Duyệt TT: ${maSV} | ${trangThai} | ${diemThamDinh}`);

        let query = `
            UPDATE HB_ThuThach
            SET 
                DiemThamDinh = ${diemThamDinh},
                TrangThai = N'${trangThai}',
                GhiChu = N'${ghiChu}',
                NgayXet = GETDATE()
            WHERE MaSV = '${maSV}' 
              AND NamHoc = '${namHoc}' 
              AND MaTieuChi = '${maTieuChi}'
        `;

        await sql.query(query);
        res.json({ success: true, message: "Đã cập nhật thành công!" });
    } catch (err) {
        console.log("❌ Lỗi Update HBTT:", err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});


// =============================================================
// 3. HỌC BỔNG DOANH NGHIỆP
// =============================================================

// Lấy danh sách đợt (từ TieuChiHocBong)
app.get('/api/dot-hb-dn', async (req, res) => {
    try {
        // Query chuẩn: Lấy MaTieuChi làm mã đợt, join với bảng DoanhNghiep để lấy tên DN
        let query = `
            SELECT 
                tc.MaTieuChi as MaDotDN, 
                tc.TenTieuChi as TenDot, 
                dn.TenDN as DonViTaiTro 
            FROM TieuChiHocBong tc
            LEFT JOIN DoanhNghiep dn ON tc.MaDN = dn.MaDN
            WHERE tc.LoaiHocBong = N'DoanhNghiep' OR tc.LoaiHocBong = N'Doanh nghiệp'
        `;
        let result = await sql.query(query);
        res.json(result.recordset);
    } catch (err) {
        console.log("❌ Lỗi tải đợt DN:", err.message);
        res.status(500).send(err.message);
    }
});

// Lấy danh sách ứng viên
app.get('/api/xetduyet-hbdn', async (req, res) => {
    try {
        let maDot = req.query.maDot; // MaTieuChi
        console.log(`🔍 HBDN: Lấy ứng viên đợt [${maDot}]`);

        let query = `
            SELECT 
                dn.MaSV, sv.HoTen, l.TenLop,
                dn.MaTieuChi as MaDotDN, 
                dn.DiemGPA, dn.DiemRL, dn.DiemHD,
                dn.LinkCV,
                ISNULL(dn.TrangThai, N'Chờ duyệt') as TrangThai
            FROM HB_DoanhNghiep dn
            JOIN SinhVien sv ON dn.MaSV = sv.MaSV
            JOIN Lop l ON sv.MaLop = l.MaLop
            WHERE dn.MaTieuChi = '${maDot}'
            ORDER BY 
                CASE WHEN dn.TrangThai = N'Chờ duyệt' THEN 0 ELSE 1 END, 
                dn.DiemGPA DESC
        `;
        
        let result = await sql.query(query);
        res.json(result.recordset);
    } catch (err) {
        console.log("❌ Lỗi lấy ứng viên DN:", err.message);
        res.status(500).send(err.message);
    }
});

// Duyệt ứng viên
app.post('/api/duyet-hbdn', async (req, res) => {
    try {
        let { maSV, maDot, trangThai } = req.body;
        console.log(`👉 Duyệt DN: ${maSV} -> ${trangThai}`);

        let query = `
            UPDATE HB_DoanhNghiep
            SET 
                TrangThai = N'${trangThai}',
                NgayXet = GETDATE()
            WHERE MaSV = '${maSV}' AND MaTieuChi = '${maDot}'
        `;

        await sql.query(query);
        res.json({ success: true, message: "Đã cập nhật thành công!" });
    } catch (err) {
        console.log("❌ Lỗi duyệt DN:", err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
});