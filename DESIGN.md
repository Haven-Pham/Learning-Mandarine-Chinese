---
version: alpha
name: "Sổ học tiếng Hoa (學習本)"
description: "Hệ thống giao diện thư tịch Á Đông hiện đại (Modern Oriental Scholarly) cho ứng dụng học tiếng Hoa Phồn thể chuẩn Đài Loan & luyện thi TOCFL."
colors:
  primary: "#86090a"
  primary-container: "#a8261f"
  on-primary: "#ffffff"
  cinnabar-subtle: "#FDF2F0"
  secondary: "#176b4b"
  secondary-container: "#a1f0c7"
  on-secondary: "#ffffff"
  jade-subtle: "#F0F8F4"
  tertiary: "#663400"
  amber: "#9A5F0C"
  amber-subtle: "#FEF8ED"
  indigo: "#1d4ed8"
  indigo-subtle: "#eff6ff"
  error: "#ba1a1a"
  error-container: "#ffdad6"
  light:
    paper-base: "#FDFBF7"
    paper-card: "#FFFFFF"
    paper-muted: "#F5EFEB"
    surface-container-low: "#f8f2f0"
    surface-container: "#f2edeb"
    surface-container-high: "#ede7e5"
    border-subtle: "#EBE2D8"
    outline: "#8d706c"
    outline-variant: "#e1bfba"
    on-surface: "#1d1b1a"
    on-surface-variant: "#59413e"
  dark:
    paper-base: "#141211"
    paper-card: "#1f1b1a"
    paper-muted: "#2a2523"
    border-subtle: "#3a3230"
    on-surface: "#F5EFEB"
    on-surface-variant: "#d6cac4"
    outline: "#9c8e88"
    primary: "#e27d78"
    secondary: "#4ade80"
    amber: "#fbbf24"
    indigo: "#60a5fa"
typography:
  display:
    fontFamily: "Noto Serif, Noto Serif TC, Georgia, serif"
    fontSize: "36px"
    fontWeight: 600
    lineHeight: 1.28
    letterSpacing: "0.025em"
  headline-lg:
    fontFamily: "Noto Serif, Noto Serif TC, serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.29
  headline-md:
    fontFamily: "Noto Serif, Noto Serif TC, serif"
    fontSize: "21px"
    fontWeight: 600
    lineHeight: 1.43
  hanzi-hero:
    fontFamily: "Noto Serif TC, Noto Serif, PingFang TC, Microsoft JhengHei, serif"
    fontSize: "80px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "0.025em"
  body-lg:
    fontFamily: "Be Vietnam Pro, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.56
  body-md:
    fontFamily: "Be Vietnam Pro, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  body-sm:
    fontFamily: "Be Vietnam Pro, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.57
  label-md:
    fontFamily: "Be Vietnam Pro, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.47
    letterSpacing: "0.02em"
  label-sm:
    fontFamily: "Be Vietnam Pro, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.38
    letterSpacing: "0.03em"
  code:
    fontFamily: "JetBrains Mono, monospace"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.57
rounded:
  sm: "4px"
  md: "8px"
  control: "10px"
  lg: "12px"
  card: "14px"
  xl: "16px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  gutter: "20px"
  lg: "24px"
  xl: "36px"
  2xl: "56px"
components:
  button-primary:
    backgroundColor: "{colors.primary-container}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.control}"
    padding: "9px 15px"
  button-primary-hover:
    backgroundColor: "{colors.primary}"
  button-secondary:
    backgroundColor: "{colors.light.paper-card}"
    textColor: "{colors.light.on-surface}"
    rounded: "{rounded.control}"
    padding: "9px 15px"
  button-speak:
    backgroundColor: "{colors.jade-subtle}"
    textColor: "{colors.secondary}"
    rounded: "{rounded.full}"
    padding: "6px 14px"
  card-panel:
    backgroundColor: "{colors.light.paper-card}"
    textColor: "{colors.light.on-surface}"
    rounded: "{rounded.card}"
    padding: "20px"
  chip:
    backgroundColor: "{colors.light.paper-card}"
    textColor: "{colors.light.on-surface}"
    rounded: "{rounded.full}"
    padding: "5px 12px"
  input-field:
    backgroundColor: "{colors.light.paper-base}"
    textColor: "{colors.light.on-surface}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
---

# Design System: Sổ học tiếng Hoa (學習本)

## Overview

**Creative North Star: "Thư tịch Á Đông Hiện đại (Modern Oriental Scholarly)"**

Sổ học tiếng Hoa là một ứng dụng học tập tĩnh chạy hoàn toàn trên trình duyệt (SPA không dùng React/GSAP/3D, dùng Tailwind CSS dựng sẵn `css/tw.css` + `style.css`), phục vụ người Việt ôn thi TOCFL Phồn thể chuẩn Đài Loan. Chế độ giao diện chính là **Operate + Read**: ưu tiên khả năng quét nhanh, độ rõ nét của chữ Hán Phồn thể, độ tương phản dễ đọc trong phiên học kéo dài và sự điềm tĩnh giống một cuốn sổ giấy xuyến ấm.

Bề mặt nền dùng tông giấy ấm (`#FDFBF7`) kết hợp mực đen than (`#1d1b1a`), điểm nhấn chu sa (đỏ ấn triện `#a8261f` / `#86090a`) cho hành động chính và xanh ngọc bích (`#176b4b`) cho trạng thái hoàn thành, phát âm và đồng bộ.

**Key Characteristics:**
- Bảng màu ấm dịu mắt mô phỏng giấy viết thư pháp và dấu triện đỏ, có đầy đủ chế độ sáng (`light`) và tối (`dark`).
- Tách bạch rõ 3 hệ chữ: **Noto Serif / Noto Serif TC** cho chữ Hán & tiêu đề, **Be Vietnam Pro** cho giao diện & giải thích tiếng Việt, **JetBrains Mono** cho pinyin, phím tắt và số liệu.
- Tối ưu thao tác học mỗi ngày trên cả điện thoại (390px, thanh điều hướng đáy cố định) và máy tính (1280px+, bố cục hai cột khi mở mặt sau thẻ học).

## Colors

Bảng màu xây dựng theo nguyên tắc giấy ấm — mực trầm, hạn chế bão hòa quá mức để người học đọc chữ Hán hàng giờ không mỏi mắt.

### Primary (Chu sa / Ấn triện)
- **Ấn Triện Sẫm (`primary`, `#86090a`)**: Chữ nhấn mạnh, trạng thái hover của nút chính, đường nhấn tiêu đề và nhãn tab đang chọn.
- **Chu Sa Nổi (`primary-container`, `#a8261f`)**: Nền nút hành động chính (CTA), biểu trưng logo `學`, huy hiệu số lượng thẻ đến hạn.
- **Giấy Phớt Chu Sa (`cinnabar-subtle`, `#FDF2F0`)**: Nền mềm cho tab đang kích hoạt và khối cảnh báo lỗi hay gặp.

### Secondary (Ngọc bích)
- **Ngọc Bích (`secondary`, `#176b4b`)**: Nút phát âm thanh (`speak`), trạng thái đã đồng bộ, tiến độ đã thuộc và đáp án đúng.
- **Giấy Phớt Ngọc (`jade-subtle`, `#F0F8F4`)**: Nền chip đồng bộ, nút loa phát âm và thẻ nhiệm vụ đã hoàn thành.

### Tertiary & Semantic
- **Hổ Phách (`amber`, `#9A5F0C` / `tertiary`, `#663400` trên nền `amber-subtle`, `#FEF8ED`)**: Mẹo nhớ Hán Việt, trạng thái "Học lại/Khó", ghi chú ngữ pháp.
- **Chàm (`indigo`, `#1d4ed8` trên nền `indigo-subtle`, `#eff6ff`)**: Ghi chú cách dùng đặc trưng Đài Loan (`tw`) và mức "Nhớ lâu".
- **Báo Lỗi (`error`, `#ba1a1a` trên `error-container`, `#ffdad6`)**: Thông báo lỗi nhập liệu, chữ viết sai trong chép chính tả.

### Neutral (Giấy xuyến & Mực)
- **Giấy Nền Sáng (`light.paper-base`, `#FDFBF7`)**: Nền toàn trang chế độ sáng.
- **Thẻ Trắng (`light.paper-card`, `#FFFFFF`)**: Nền thẻ học, bảng điều khiển, thanh tìm kiếm.
- **Giấy Mờ (`light.paper-muted`, `#F5EFEB`)**: Nền phụ cho rãnh thanh tiến độ, trạng thái hover nhẹ, ô thông số phụ.
- **Viền Nhẹ (`light.border-subtle`, `#EBE2D8`)**: Đường kẻ phân tách 1px của thẻ, ô nhập và danh sách.
- **Mực Chính (`light.on-surface`, `#1d1b1a`)**: Văn bản chính và chữ Hán (độ tương phản > 15:1 trên nền sáng).
- **Mực Phụ (`light.on-surface-variant`, `#59413e`)**: Chú thích, nhãn phụ, mô tả (độ tương phản > 8:1 trên nền sáng).
- **Chế độ tối (`dark.*`)**: Chuyển sang nền than ấm (`#141211`), thẻ `#1f1b1a`, viền `#3a3230`, chữ `#F5EFEB`, đồng thời nâng độ sáng màu nhấn (`#e27d78`, `#4ade80`, `#fbbf24`) để giữ độ tương phản ≥ 4.5:1.

### Named Rules
**The Restrained Cinnabar Rule.** Màu chu sa (`#a8261f` / `#86090a`) chỉ dành cho hành động chính duy nhất mỗi màn hình, trạng thái tab đang chọn và dấu nhấn học thuật; không tô nền đậm lên nhiều khối cùng lúc.

## Typography

**Display & Hanzi Font:** `Noto Serif`, `Noto Serif TC` (dự phòng `PingFang TC`, `Microsoft JhengHei`, `Georgia`, `serif`)
**Body & UI Font:** `Be Vietnam Pro` (dự phòng `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `sans-serif`)
**Code / Pinyin / Tabular Font:** `JetBrains Mono` (dự phòng `monospace`)

**Character:** Chữ Hán Phồn thể dùng nét có chân (`Noto Serif TC`) tạo độ rõ nét cho từng nét sổ/phẩy ở cỡ lớn lẫn cỡ ví dụ, trong khi tiếng Việt dùng `Be Vietnam Pro` tối ưu dấu thanh và độ dễ đọc trên màn hình mật độ cao.

### Hierarchy
- **Hanzi Hero** (`700`, `80px`, line-height `1.15`, tracking `0.025em`): Chữ Hán ở mặt trước Flashcard (`.front .big`).
- **Display** (`600`, `36px`, line-height `1.28`): Tiêu đề lớn trang chủ và từ đang tra chi tiết.
- **Headline Large / Medium** (`600–700`, `28px` / `21px`): Tiêu đề màn hình và tên nhóm nội dung (`.h2` cỡ `20px`).
- **Body Large / Medium / Small** (`400`, `18px` / `16px` / `14px`, line-height `1.5–1.6`): Nghĩa tiếng Việt, mô tả bài học, nội dung giải thích. Trong phần giải thích mặt sau thẻ học (`.sb-more .rich`), ví dụ tiếng Hoa nâng lên `24px` và nghĩa tiếng Việt `18–19px` để dễ đọc khi ôn nhanh.
- **Label & Pinyin** (`500–600`, `13px–15px`): Nhãn nút, tab điều hướng, thanh trạng thái; pinyin dùng `JetBrains Mono` kết hợp `<ruby><rt>` căn giữa (`ruby-align: center`).

### Named Rules
**The Readable Scale Rule.** Cỡ chữ nhỏ nhất cho văn bản thông tin trên giao diện phải ≥ `12.5px` (được bảo đảm bởi lớp nâng cỡ chữ ở cuối `style.css`); số liệu đếm thẻ và bảng điểm luôn bật `font-variant-numeric: tabular-nums`.

## Layout

Ứng dụng dùng mô hình **Single-Page Container cố định chiều rộng tối đa**:
- Khung chính trang thường: `max-w-7xl` (`1280px`) hoặc `.view` (`max-width: 1240px`), riêng màn hình học Flashcard mở rộng `.study-wide` (`1360px`) để chứa bố cục 2 cột.
- Header cố định trên cùng cao `80px` (`h-20`), phần `<main>` đẩy xuống `pt-20` và chừa đáy `pb-20` trên thiết bị `< 1280px` để tránh bị thanh điều hướng đáy (`#mobileBottomNav`) che nội dung.
- **Breakpoints chính**:
  - Di động (`390px` / `< 640px`): lưới 1 cột (`.row2`, `.row3`, `.row4` xếp dọc), nút chấm điểm SRS xếp `2×2`, thanh điều hướng đáy 6 mục + nút menu hamburger mở ngăn kéo 8 mục.
  - Máy tính bảng (`640px–1023px`): lưới 2 cột cho thư mục và bộ từ.
  - Máy tính (`≥ 1024px` và `≥ 1280px`): thanh điều hướng ngang 7 tab không xuống dòng (`white-space: nowrap`), mặt sau thẻ học chia 2 cột (`11fr : 9fr`) với cột giải thích bên phải cuộn độc lập (`sticky top: 80px`) giữ nút chấm điểm bên trái luôn trong tầm mắt.

## Elevation & Depth

Hệ thống ưu tiên **phân tầng sắc độ giấy + viền mỏng 1px** thay cho bóng đổ nặng:
- Bề mặt nền (`#FDFBF7`) → thẻ nổi (`#FFFFFF` + viền `1px solid #EBE2D8`).
- Bóng đổ rất nhẹ và mang sắc ấm (`rgba(44, 42, 41, 0.03–0.08)`), chỉ tăng nhẹ khi hover nút/thẻ hoặc trên thanh điều hướng cố định (`backdrop-blur-xl`).

### Named Rules
**The Paper-First Elevation Rule.** Mỗi khối nội dung mặc định dùng nền giấy + viền 1px mảnh; không lồng nhiều lớp thẻ chồng bóng đổ lên nhau.

## Shapes

Ngôn ngữ hình khối bo tròn mềm vừa phải, đồng bộ giữa các cấp độ:
- **Ô nhỏ & phím tắt**: `4px` (`sm`).
- **Nút điều hướng & nhãn tab**: `8px` (`md`).
- **Nút bấm chuẩn & ô nhập liệu**: `10px` (`control`).
- **Thẻ nhiệm vụ & khối ghi chú**: `12px` (`lg`).
- **Thẻ chính & panel (`.panel`, `.folder`)**: `14px` (`--r`).
- **Flashcard lớn (`.card`)**: `16px` (`xl`).
- **Chip lọc, nhãn cấp độ (`.pill`), nút loa (`.speak`), trạng thái đồng bộ**: Bo tròn hoàn toàn (`9999px`).

## Components

### Buttons
- **Primary (`.btn.primary`)**: Nền `#a8261f`, chữ trắng `#ffffff`, bo `10px`, đệm `9px 15px`, hover chuyển `#86090a`.
- **Secondary (`.btn`)**: Nền `#FFFFFF`, viền `1px solid #EBE2D8`, chữ `#1d1b1a`, hover chuyển nền `#F5EFEB`.
- **Audio / Speak (`.speak`)**: Dạng viên thuốc (`9999px`), nền `#F0F8F4`, chữ `#176b4b`, viền mờ `rgba(23,107,75,0.2)`, hover `#d7ede1`.
- **SRS Grade Buttons (`.srs-grade-btn`)**: Lưới 4 nút (`Quên` đỏ, `Khó` hổ phách, `Nhớ` xanh lá, `Dễ` xanh lam) kèm nhãn thời gian ôn lại và phím tắt `1–4` (`JetBrains Mono`), chuyển lưới `2×2` trên di động.

### Chips & Pills
- **Filter Chips (`.chip`)**: Bo `9999px`, nền trắng, viền `#EBE2D8`, padding `5px 12px`; hover đổi viền và chữ sang `#86090a`.
- **Memory Level Pills (`.pill.lv-0..5`)**: 6 sắc độ ngữ nghĩa cố định (Chưa học → Mới học → Nhớ tạm → Nhớ lâu → Thuộc lòng → Thông thạo).

### Cards / Containers
- **Panel chuẩn (`.panel`)**: Nền `#FFFFFF`, viền `1px solid #EBE2D8`, bo `14px`, đệm `20px`.
- **Thẻ học Flashcard (`.card`)**: Bo `16px`, đệm `24px 20px 20px`, chứa mặt trước chữ Hán cỡ `80px` và mặt sau chia cột giải thích chi tiết (`.study-back`).
- **Ô luyện viết chữ Hán (`.hw` / `.mi-zi-ge`)**: Ô vuông `140×140px` kẻ lưới chữ mễ (米字格) trên nền giấy `#FAF6F0` phục vụ Hanzi Writer.

### Inputs / Fields
- **Trường nhập chuẩn**: Nền `#FDFBF7`, viền `1px solid #EBE2D8`, bo `10px`, đệm `10px 12px`; trạng thái `:focus-visible` đổi viền sang `#86090a` kèm vòng focus `3px` màu `rgba(168,38,31,0.12)`.
- **Ô chép chính tả (`#dictation-input`)**: Dùng font chữ Hán `Noto Serif TC`, cỡ `22px` trên desktop / `19px` trên di động, `letter-spacing: 0.05em`.

### Navigation
- **Desktop (`≥ 1280px`)**: 7 tab ngang trên header cố định (`Trang chủ`, `Từ vựng`, `Ngữ pháp`, `Tra & Nhập từ`, `Chép chính tả`, `Thi thử TOCFL`, `Cài đặt`), tab hiện tại dùng `aria-current="page"` với nền `#FDF2F0` và chữ `#86090a`.
- **Mobile (`< 1280px`)**: Thanh điều hướng đáy cố định 6 mục quan trọng nhất + nút menu hamburger mở danh sách đầy đủ 8 lối vào.

## Do's and Don'ts

### Do:
- **Do** giữ độ tương phản văn bản tối thiểu `4.5:1` (và `3:1` cho chữ lớn / nút) ở cả hai chế độ `light` và `dark`.
- **Do** đồng bộ mọi token tùy chỉnh giữa `tools/tailwind.config.js`, block `tailwind.config` trong `index.html`, và biến CSS trong `style.css`; sau khi thêm lớp Tailwind mới phải build lại `css/tw.css` để hoạt động offline.
- **Do** dùng `<ruby>` tách từng chữ kèm `ruby-align: center` cho cụm chữ Hán có pinyin để chữ không bị giãn cách bất thường.
- **Do** giữ vùng chạm tối thiểu `44×44px` cho các nút thao tác chính trên di động (`390px`), và đảm bảo mọi nút/liên kết đều có vòng `:focus-visible` rõ ràng cho người dùng bàn phím.
- **Do** tôn trọng `prefers-reduced-motion: reduce` khi có hiệu ứng chuyển trạng thái.

### Don't:
- **Don't** thêm React, GSAP, thư viện 3D hoặc hiệu ứng chuyển động trang trí không phục vụ trạng thái học tập.
- **Don't** dùng nhãn eyebrow lặp lại trên mọi mục hoặc đánh số mục `01 / 02 / 03` kiểu trang quảng cáo.
- **Don't** kết hợp viền đậm 1 bên (stripe border) trên các hộp bo tròn một cách tùy tiện, hoặc dùng bóng đổ cứng kiểu neobrutalism.
- **Don't** đặt phông chữ có chân (`Noto Serif`) cho nút bấm giao diện hay chỉ số nhỏ; giữ `Be Vietnam Pro` cho UI tiếng Việt và `JetBrains Mono` cho mã/số liệu/pinyin.
- **Don't** thay đổi định dạng lưu trữ tiến độ trong `js/store.js` / `js/sync.js` khi chỉnh sửa giao diện.
