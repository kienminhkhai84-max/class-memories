# 📚 Kỷ Niệm Lớp

Website lưu giữ kỷ niệm lớp học — Full-stack trên Cloudflare.

**Tech Stack:** Cloudflare Workers + D1 (Database) + R2 (Image Storage) + GitHub API (Backup)

---

## 📁 Cấu trúc

```
class-memories/
├── public/
│   └── index.html        ← Frontend SPA (React)
├── src/
│   └── worker.js          ← Backend API (Workers)
├── schema.sql             ← Database schema (D1)
├── wrangler.toml          ← Cấu hình Cloudflare
├── package.json
└── README.md
```

---

## 🚀 Hướng Dẫn Deploy (Từng Bước)

### Bước 0 — Cài đặt

```bash
# Cài Node.js (nếu chưa có): https://nodejs.org
# Cài Wrangler CLI
npm install -g wrangler

# Đăng nhập Cloudflare
wrangler login
```

### Bước 1 — Tạo D1 Database

```bash
# Tạo database
wrangler d1 create ky-niem-lop-db
```

Terminal sẽ hiện ra một đoạn như này:
```
✅ Successfully created DB 'ky-niem-lop-db'

[[d1_databases]]
binding = "DB"
database_name = "ky-niem-lop-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**→ Copy `database_id` rồi paste vào `wrangler.toml`** thay cho `YOUR_D1_DATABASE_ID`.

### Bước 2 — Tạo R2 Bucket

```bash
wrangler r2 bucket create ky-niem-lop-images
```

### Bước 3 — Khởi tạo Database

```bash
# Chạy schema.sql để tạo bảng
wrangler d1 execute ky-niem-lop-db --file=./schema.sql --remote
```

### Bước 4 — Test Local

```bash
npm install
npm run dev
```

Mở `http://localhost:8787` — đăng nhập bằng `truehieu` / `hieu2011@`

### Bước 5 — Deploy

```bash
npm run deploy
```

Xong! Web sẽ live tại `https://ky-niem-lop.YOUR_SUBDOMAIN.workers.dev`

---

## 🔄 Deploy qua GitHub (Tự động)

Nếu muốn auto-deploy mỗi khi push code:

1. Push code lên GitHub
2. Vào [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create**
3. **Connect to Git** → chọn repo
4. Cấu hình:
   - **Build command:** `npm install`
   - **Deploy command:** `npx wrangler deploy`
5. Thêm biến môi trường: `CLOUDFLARE_API_TOKEN` (tạo token tại Cloudflare)

---

## 🔑 Tài khoản

| Role  | Username  | Password  |
|-------|----------|-----------|
| Owner | truehieu | hieu2011@ |

Owner được tạo tự động lần đầu truy cập.

---

## 👥 Phân quyền

| Tính năng              | Owner | Admin | Member |
|-----------------------|-------|-------|--------|
| Xem kỷ niệm          | ✅    | ✅    | ✅     |
| Upload ảnh            | ✅    | ✅    | ✅     |
| Comment & Reaction    | ✅    | ✅    | ✅     |
| Xoá ảnh bất kỳ       | ✅    | ✅    | ❌ (chỉ ảnh mình) |
| Thêm/Xoá hồ sơ lớp   | ✅    | ✅    | ❌     |
| Dashboard             | ✅    | ✅    | ❌     |
| Quản lý user          | ✅    | ✅ (chỉ member) | ❌ |
| Thăng/Giáng cấp Admin | ✅    | ❌    | ❌     |
| Cấu hình Storage      | ✅    | ❌    | ❌     |

---

## 📦 Storage

### Cloudflare R2 (Chính)
- Ảnh được upload trực tiếp lên R2 qua Worker
- Serve qua endpoint `/api/images/:key`
- Free tier: 10GB storage, 10 triệu request/tháng

### GitHub Repo (Backup)
- Cấu hình trong Dashboard → Storage Config
- Nhập GitHub Token (Personal Access Token) + Repo name
- Ảnh sẽ được push vào thư mục `images/` trong repo
- Token cần quyền `repo` (full control)

Tạo GitHub Token tại: https://github.com/settings/tokens/new
- Chọn scope: `repo`
- Copy token → paste vào Dashboard

---

## 🛠️ API Endpoints

| Method | Endpoint                   | Auth     | Mô tả                    |
|--------|---------------------------|----------|--------------------------|
| POST   | /api/auth/login           | ❌       | Đăng nhập                |
| POST   | /api/auth/register        | ❌       | Đăng ký                  |
| GET    | /api/auth/me              | ✅       | Thông tin user hiện tại  |
| POST   | /api/auth/logout          | ✅       | Đăng xuất                |
| GET    | /api/memories             | ✅       | Danh sách ảnh            |
| POST   | /api/memories             | ✅       | Upload ảnh (FormData)    |
| DELETE | /api/memories/:id         | ✅       | Xoá ảnh                  |
| GET    | /api/images/:key          | ❌       | Serve ảnh từ R2          |
| GET    | /api/profiles             | ✅       | Danh sách hồ sơ          |
| POST   | /api/profiles             | 🛡️ Admin | Thêm hồ sơ (FormData)   |
| DELETE | /api/profiles/:id         | 🛡️ Admin | Xoá hồ sơ               |
| GET    | /api/comments             | ✅       | Danh sách bình luận      |
| POST   | /api/comments             | ✅       | Thêm bình luận           |
| DELETE | /api/comments/:id         | 🛡️ Admin | Xoá bình luận            |
| GET    | /api/reactions            | ✅       | Danh sách reactions      |
| POST   | /api/reactions            | ✅       | Toggle reaction          |
| GET    | /api/users                | 🛡️ Admin | Danh sách user           |
| POST   | /api/users                | 🛡️ Admin | Tạo user                 |
| DELETE | /api/users/:username      | 🛡️ Admin | Xoá user                 |
| PATCH  | /api/users/:username/role | 👑 Owner | Đổi role                 |
| GET    | /api/config               | 👑 Owner | Xem cấu hình            |
| POST   | /api/config               | 👑 Owner | Lưu cấu hình            |
| GET    | /api/stats                | 🛡️ Admin | Thống kê hệ thống       |

---

## ❓ FAQ

**Q: Dữ liệu có mất khi deploy lại không?**
A: Không. D1 và R2 là persistent storage, dữ liệu giữ nguyên.

**Q: Tốn phí không?**
A: Free tier của Cloudflare rất thoải mái cho dự án lớp học:
- Workers: 100,000 request/ngày
- D1: 5 triệu rows read/ngày
- R2: 10GB storage miễn phí

**Q: Muốn dùng tên miền riêng?**
A: Vào Cloudflare Dashboard → Workers → Settings → Custom Domains
