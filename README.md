![LogTime AI](docs/assets/banner.webp)

# LogTime AI

Trợ lý log time cho Redmine: lập kế hoạch công việc theo ngày/tuần, để AI phân bổ đủ 8 giờ, rồi đồng bộ lên Redmine.

![Không gian làm việc](docs/assets/workspace.webp)

## Tính năng

- **LogTime hàng ngày / theo tuần** — thêm task thủ công, nhập nhanh từ văn bản thô, AI phân bổ đủ 8.0 giờ mỗi ngày.
- **Thời gian đã báo cáo** — lịch sử spent time trên Redmine theo ngày, đánh dấu ngày chưa log.
- **Dashboard Redmine** — ticket của bạn, biểu đồ trạng thái/độ ưu tiên/dự án, heatmap 6 tháng.
- **Thống kê nhóm** — tổng giờ và trung bình mỗi ngày của từng thành viên trong tháng.

## Chạy ở chế độ phát triển

```bash
git clone --recurse-submodules <repo-url>   # redmine-cli-src là git submodule
npm install
npm run dev
```

Cần cài [redmine CLI](redmine-cli-src) tại `~/.local/bin/redmine` (hoặc đặt biến `REDMINE_BIN`) và cấu hình server/API key trong mục **Cấu hình**.

## Bản desktop (Linux, Windows, macOS)

App desktop dùng Electron và đã kèm sẵn redmine CLI cho từng nền tảng.

```bash
npm run desktop      # build và mở app để thử
npm run dist:linux   # release/*.AppImage, *.deb
npm run dist:win     # release/*.exe (trình cài NSIS)
npm run dist:mac     # release/*.dmg — chạy trên macOS
```

Script `build:redmine` biên dịch redmine CLI bằng Go nếu có, nếu không thì dùng Docker. Workflow `.github/workflows/desktop.yml` build cả 3 nền tảng trên GitHub Actions.

Các bản build chưa được ký số, nên Windows SmartScreen và macOS Gatekeeper sẽ cảnh báo khi mở lần đầu.

## Triển khai lên k3s

```bash
./deploy.sh
```
