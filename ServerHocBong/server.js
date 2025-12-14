const express = require('express');
const sql = require('mssql/msnodesqlv8'); 
const cors = require('cors');

const app = express();
app.use(cors());

// CẤU HÌNH KẾT NỐI (Dành cho Windows Authentication)
const config = {
   connectionString: 'Driver={ODBC Driver 17 for SQL Server};Server=DESKTOP-TGHEQS6;Database=QLHocBongUTE;Trusted_Connection=yes;'
};

// Hàm kiểm tra kết nối
async function connectDB() {
    try {
        await sql.connect(config);
        console.log("✅ Đã kết nối SQL Server bằng Windows Authentication!");
    } catch (err) {
        console.log("❌ Lỗi kết nối:", err.message);
    }
}
connectDB();

// =============================================================
// API: XÉT DUYỆT HB KHUYẾN KHÍCH
// =============================================================
app.get('/api/xetduyet-hbkk', async (req, res) => {
    try {
        let maHK = 'HK2'; 
        
        // 1. KHAI BÁO BIẾN TỪ URL
        let maKhoa = req.query.maKhoa ? req.query.maKhoa.trim() : ""; 
        
        let loaiHB = req.query.loaiHB; 

        console.log("---------------------------------------");
        console.log(`1. Server nhận yêu cầu: Khoa=[${maKhoa}], Loại=[${loaiHB}]`);

        // 2. QUERY CƠ BẢN
        let sqlQuery = `
            SELECT 
                sv.MaSV, sv.HoTen, l.TenLop, RTRIM(l.MaKhoa) as MaKhoa,
                g.GPA, d.DiemRL, 
                ISNULL((SELECT SUM(DiemChot) FROM DiemHoatDong hd 
                        WHERE hd.MaSV = sv.MaSV AND hd.MaHK = '${maHK}' AND hd.TrangThai = N'Đạt'), 0) as DiemHD,
                N'Đủ điều kiện' as GhiChuSystem
            FROM SinhVien sv
            JOIN Lop l ON sv.MaLop = l.MaLop
            JOIN GPA_SinhVien g ON sv.MaSV = g.MaSV
            JOIN DiemRenLuyen d ON sv.MaSV = d.MaSV
            WHERE g.MaHK = '${maHK}' 
              AND d.DiemRL >= 70
        `;

        // 3. XỬ LÝ LỌC LOẠI HỌC BỔNG (GPA)
        if (loaiHB === 'A') {
            console.log("-> Lọc Loại A (GPA >= 3.6)");
            sqlQuery += ` AND g.GPA >= 3.6 `;
        } 
        else if (loaiHB === 'B') {
            console.log("-> Lọc Loại B (3.2 <= GPA < 3.6)");
            sqlQuery += ` AND g.GPA >= 3.2 AND g.GPA < 3.6 `;
        } 
        else {
            console.log("-> Không chọn loại: Lấy tất cả (GPA >= 3.2)");
            sqlQuery += ` AND g.GPA >= 3.2 `;
        }

        // 4. XỬ LÝ LỌC KHOA
        if (maKhoa && maKhoa !== 'null' && maKhoa !== 'undefined' && maKhoa !== '') {
            console.log(`-> Lọc Khoa: ${maKhoa}`);
            sqlQuery += ` AND RTRIM(l.MaKhoa) = '${maKhoa}' `; 
        }

        sqlQuery += ` ORDER BY g.GPA DESC`;

        // 5. CHẠY QUERY
        let result = await sql.query(sqlQuery);
        res.json(result.recordset);

    } catch (err) {
        console.log("❌ Lỗi Server:", err); 
        res.status(500).send(err.message);
    }
});

// [MỚI] API LẤY DANH SÁCH KHOA
app.get('/api/khoa', async (req, res) => {
    try {
        let result = await sql.query('SELECT * FROM Khoa');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).send(err.message);
    }
});


// ===================================================
// API 1: LẤY DANH SÁCH HỒ SƠ THỬ THÁCH (Theo năm học)
app.get('/api/xetduyet-hbtt', async (req, res) => {
    try {
        let namHoc = req.query.namHoc || '2024-2025'; 

        let query = `
            SELECT 
                tt.MaSV, sv.HoTen, l.TenLop,
                tt.NamHoc, tt.MaTieuChi,
                tt.DiemGPA_Nam, tt.DiemRL_Nam, 
                tt.LinkMinhChung, 
                tt.DiemTuDanhGia, 
                ISNULL(tt.DiemThamDinh, tt.DiemTuDanhGia) as DiemThamDinh, -- Mặc định lấy điểm tự đánh giá nếu chưa chấm
                ISNULL(tt.TrangThai, N'Chờ duyệt') as TrangThai
            FROM HB_ThuThach tt
            JOIN SinhVien sv ON tt.MaSV = sv.MaSV
            JOIN Lop l ON sv.MaLop = l.MaLop
            WHERE tt.NamHoc = '${namHoc}'
            ORDER BY 
                CASE WHEN tt.TrangThai = N'Chờ duyệt' THEN 0 ELSE 1 END, -- Ưu tiên hồ sơ chờ lên đầu
                tt.DiemGPA_Nam DESC
        `;

        console.log("--> Lấy DS HB Thử Thách:", query);
        let result = await sql.query(query);
        res.json(result.recordset);
    } catch (err) {
        console.log("Lỗi:", err);
        res.status(500).send(err.message);
    }
});

// API 2: LƯU KẾT QUẢ DUYỆT (Cập nhật trạng thái + Điểm)
app.use(express.json());

app.post('/api/duyet-hbtt', async (req, res) => {
    try {
        let { maSV, namHoc, maTieuChi, diemThamDinh, trangThai, ghiChu } = req.body;
        
        console.log(`--> Đang duyệt: ${maSV} - ${trangThai} - Điểm: ${diemThamDinh}`);

        let query = `
            UPDATE HB_ThuThach
            SET 
                DiemThamDinh = ${diemThamDinh},
                TrangThai = N'${trangThai}',
                GhiChu = N'${ghiChu}',
                NgayXet = GETDATE() -- Cập nhật ngày xét
            WHERE MaSV = '${maSV}' 
              AND NamHoc = '${namHoc}' 
              AND MaTieuChi = '${maTieuChi}'
        `;

        await sql.query(query);
        res.json({ success: true, message: "Đã cập nhật thành công!" });

    } catch (err) {
        console.log("Lỗi Update:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});


// =============================================================
// KHU VỰC API: HỌC BỔNG DOANH NGHIỆP
// =============================================================

// 1. LẤY DANH SÁCH CÁC ĐỢT TÀI TRỢ
app.get('/api/dot-hb-dn', async (req, res) => {
    try {
        let result = await sql.query("SELECT MaDotDN, TenDot, MaDN as DonViTaiTro FROM DotHB_DoanhNghiep");
        res.json(result.recordset);
    } catch (err) {
        console.log("Lỗi tải đợt:", err);
        res.status(500).send(err.message);
    }
});

// 2. LẤY DANH SÁCH ỨNG VIÊN CỦA 1 ĐỢT
app.get('/api/xetduyet-hbdn', async (req, res) => {
    try {
        let maDot = req.query.maDot; 
        console.log("--> Lấy DS Doanh nghiệp đợt:", maDot);

        let query = `
            SELECT 
                dn.MaSV, sv.HoTen, l.TenLop,
                dn.MaDotDN,
                dn.DiemGPA, dn.DiemRL, dn.DiemHD,
                dn.LinkCV,
                ISNULL(dn.TrangThai, N'Chờ duyệt') as TrangThai
            FROM HB_DoanhNghiep dn
            JOIN SinhVien sv ON dn.MaSV = sv.MaSV
            JOIN Lop l ON sv.MaLop = l.MaLop
            WHERE dn.MaDotDN = '${maDot}'
            ORDER BY 
                CASE WHEN dn.TrangThai = N'Chờ duyệt' THEN 0 ELSE 1 END, 
                dn.DiemGPA DESC
        `;
        
        let result = await sql.query(query);
        res.json(result.recordset);
    } catch (err) {
        console.log("Lỗi lấy ứng viên:", err);
        res.status(500).send(err.message);
    }
});

// 3. DUYỆT / TỪ CHỐI ỨNG VIÊN
app.post('/api/duyet-hbdn', async (req, res) => {
    try {
        let { maSV, maDot, trangThai } = req.body;
        console.log(`--> Duyệt DN: ${maSV} -> ${trangThai}`);

        let query = `
            UPDATE HB_DoanhNghiep
            SET 
                TrangThai = N'${trangThai}',
                NgayXet = GETDATE()
            WHERE MaSV = '${maSV}' AND MaDotDN = '${maDot}'
        `;

        await sql.query(query);
        res.json({ success: true, message: "Đã cập nhật trạng thái thành công!" });
    } catch (err) {
        console.log("Lỗi duyệt:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});


// CHẠY SERVER
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server đang chạy tại http://localhost:${PORT}`);
});