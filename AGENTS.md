# Hướng dẫn cho agent (Codex, Antigravity, Claude)

Web học tiếng Hoa (Phồn thể, chuẩn Đài Loan) của một người học Việt Nam đang ôn TOCFL. Trả lời người dùng bằng **tiếng Việt**.

## Quy tắc bắt buộc

1. **Kéo bản mới trước khi sửa**: `git pull --rebase`. Ba agent cùng sửa repo này.
2. **Dữ liệu nguồn nằm trên Drive**: `G:/My Drive/Mandarine Chinese/10 Website học tiếng Hoa/du-lieu-tu-vung`. Định dạng và quy tắc soạn: đọc `source/tu-vung/README.md` (bản chép của README trên Drive). Không sửa tay `data/rich*`, `data/decks.json`, vì build sẽ tạo lại.
3. **Build và đưa lên**: `sh tools/push_all.sh "<mô tả>"`. Script chạy mọi build, tăng phiên bản `sw.js`, commit, push. Khi sửa `js/*.js`, tăng `?v=` của file đó trong `index.html`.
4. **Repo công khai**: không ghi tên thật, điểm, số tiền, chuyện sức khỏe của người dùng vào câu ví dụ hay code. Không chép câu trong đề thi TOCFL hay giáo trình vào dữ liệu soạn (câu ví dụ phải tự viết).
5. Không đọc hay in token đồng bộ (`syncToken`). Không đổi định dạng dữ liệu tiến độ trong `js/store.js` / `js/sync.js` nếu chưa được giao.
6. Sau mỗi đợt soạn từ: cập nhật `TIEN-DO.md` (build tự làm) và ghi vài dòng vào README trên Drive nếu có quy tắc mới.
7. Deploy lỗi "No artifacts named github-pages" là lỗi tạm thời của GitHub: đẩy một commit rỗng để chạy lại.

## Bảng phân việc

Đánh `[x]` khi xong, ghi ngày và agent. Việc đang làm: ghi `(đang làm – <agent>)` để agent khác không làm trùng.

### Antigravity: soạn dữ liệu số lượng lớn

- [ ] **Band C**: soạn tiếp `tu/c-NNN.json` theo thứ tự pinyin của `data/tocfl.json`, bắt đầu từ từ chưa có (TIEN-DO dòng C; lúc giao việc còn khoảng 1700 từ, từ tiếp theo khoảng 加快). Mỗi file 20–35 từ, mỗi từ đủ trường + 3 câu ví dụ, `mh` theo mẫu Hán Việt → pinyin trong README.
- [ ] **Từ cơ bản còn thiếu giải thích đầy đủ**: khoảng 16 Novice 1, 4 Novice 2, 53 A1, 70 B1, 79 B2 (ví dụ 個 喜歡 老師 爺爺 奶奶 家庭 經驗 習慣 醫院 愛情 按 抱 報警). Lấy danh sách bằng cách so `data/tocfl.json` với các khóa trong `data/rich-tu/*.json`. Soạn vào `tu/<band>-extra-NNN.json`.
- [ ] **Chép chính tả**: thêm bài `chinh-ta/<band>-NN.json` (B1, B2, C), đúng độ dài câu trong README.
- [ ] **Ngữ pháp**: thêm mẫu theo TBCL vào `ngu-phap/`.

### Codex: việc code nhỏ, rõ phạm vi

- [ ] **Giao diện (chỉ bắt đầu sau 27/11/2026, khi người dùng cho phép)**: tài liệu tham khảo đã tải ở `C:\Users\haven\Projects\thiet-ke-tham-khao\` (impeccable, awesome-design-md, design.md). Bước 1: viết `DESIGN.md` mô tả giao diện hiện tại (màu, font, cỡ chữ, nút, thẻ). Bước 2: rà từng màn hình theo quy tắc Impeccable, sửa từng đợt nhỏ, chụp ảnh trước và sau ở 390px và 1280px. Không thêm React, GSAP, 3D.
- [ ] Viết test nhỏ (node) cho phần gộp tiến độ khi đồng bộ trong `js/store.js` (`importAll`): srs, stats, settings.dictation.
- [ ] Rà `tools/build_*.py`: báo lỗi rõ ràng khi file JSON nguồn hỏng (in tên file và dòng).

### Claude: kiểm tra và việc nhạy cảm

- Đồng bộ giữa các máy (`js/sync.js`, `js/store.js`), logic SRS (`js/srs.js`, `buildQueue` trong `js/app.js`).
- Bộ từ cá nhân (`ca-nhan/`: phỏng vấn, tự truyện) vì có thông tin riêng.
- Rà lại chất lượng các đợt soạn của Antigravity khi người dùng yêu cầu.
