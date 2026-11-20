# Dữ liệu từ vựng (nguồn)

Thư mục này là **nguồn** của phần giải thích đầy đủ và bài tình huống trên trang học.
Sửa ở đây, rồi build để đưa lên web.

## Cấu trúc

```
du-lieu-tu-vung/
  b1/chu-de.json     danh sách chủ đề của band và từ thuộc mỗi chủ đề
  b1/gd-01.json      một bài khoảng 20 từ cùng tình huống (chủ đề gd, bài 1)
  b1/gd-02.json      ...
  b2/...             (tương tự cho các band khác)
```

Trang học dạy từ mới **theo thứ tự bài**: thứ tự chủ đề trong `chu-de.json`, sau đó số bài.

## Một bài (`<chủ đề>-<số>.json`)

```json
{
 "id": "b1-gd-01", "band": "B1", "chu_de": "gd", "ten": "Tên bài",
 "tinh_huong": "Mô tả ngắn cảnh trong bài",
 "hoi_thoai": [["Người nói", "câu tiếng Hoa", "nghĩa tiếng Việt"], ...],
 "doan_van": {"zh": "...", "vn": "...", "cau_hoi": {"q": "...", "opts": ["...", "...", "...", "..."], "ans": 1}},
 "tu": {
  "từ": {
   "vn": "nghĩa ngắn",
   "ng": ["nghĩa 1", "nghĩa 2"],
   "us": "cách dùng",
   "co": ["cụm|nghĩa"], "sy": ["từ|ghi chú"], "an": ["từ|nghĩa"], "cf": ["từ dễ nhầm|khác nhau thế nào"],
   "mk": "lỗi hay gặp", "tw": "người Đài nói thế nào", "mh": "mẹo nhớ qua Hán Việt",
   "vd": [{"t": "tình huống", "zh": "câu", "vn": "nghĩa"}, ... 3 câu]
  }
 }
}
```

## Quy tắc soạn

- Chữ Phồn thể, cách nói của Đài Loan.
- Câu tự soạn, theo tình huống giống đề thi (hội thoại công sở, trường học, đời sống, tin tức, thông báo).
- **Không chép câu trong đề thi TOCFL hay giáo trình**: các câu đó có bản quyền. Đề thi riêng nằm trong `bo-cau-rieng/`, chỉ được nạp vào trình duyệt; trang tự tìm câu trong đề có chứa từ và hiện mục "Gặp trong đề thi của bạn" (chỉ trên máy của bạn).
- `vn`: khi âm Hán Việt cũng là từ tiếng Việt cùng nghĩa, ghi từ đó **trước** (響應 → "hưởng ứng; đáp lại", không dịch theo tiếng Anh "respond"). Nếu giống âm mà khác nghĩa (激動 kích động = xúc động), ghi rõ trong `mk`.
- Mỗi từ có 3 câu ví dụ, ít nhất 2 câu chứa đúng từ đó (câu thứ 2 dùng cho thẻ Điền từ).
- Hội thoại dùng được càng nhiều từ của bài càng tốt.
- Từ lẻ (không cần bài): `tu/<band>-<chủ đề>-NNN.json` = {"tu": {từ: {...các trường như trên, thêm "lt" lượng từ}}}, build bằng `python tools/build_rich_words.py "<thư mục này>"` (sau build_rich.py).
- Pinyin không cần viết: lúc build, script tự tạo (ưu tiên cách đọc Đài Loan trong bảng TOCFL). Nếu một câu bị đọc sai, thêm `"py": "..."` vào câu đó.

## Tên file từ lẻ

- `tu/b1-<chủ đề>-NNN.json`: từ B1 theo thứ tự chủ đề trong `b1/chu-de.json` (gd, tc, cv, ht, ms, au, dl, sk, no, gt, tn, xh, kh, gp, td, bd, tg, sl, vt, mt, hd, pl, tt, kn, lt).
- `tu/b2-NNN.json`, `tu/c-NNN.json`: B2 và C chưa có danh sách chủ đề, nên soạn theo thứ tự trong `data/tocfl.json` (theo pinyin). B1 đã xong 1172/1172 ngày 2026-11-17.
- `tu/rieng-NNN.json`: **từ riêng của bạn** (không thuộc danh sách TOCFL, ví dụ 海灣, 番石榴). Gửi danh sách là được soạn ưu tiên.
- Mỗi file khoảng 20–35 từ. Một từ chỉ được có ở một file (build báo lỗi nếu trùng).
- Tên từ có dạng TOCFL như `舅舅/舅`, `金(子)`, `兇/凶` thì giữ nguyên dạng đó làm khóa.

## Từ chép trong vở lớp học (`lop/`)

- Ảnh vở ghi → `lop/<đợt>-<a,b,c…>-<ngày>.json`, mỗi trang vở một file. Dòng đầu `{"deck": {"id": "lop-tu-vung-dotN", "name": "Lớp học · Từ vựng đợt N", "order": …, "kind": "vocab"}}` (các file sau của cùng đợt chỉ cần `{"deck": {"id": …}}`), sau đó `"tu"` giống `tu/*.json`, thêm `pos`, `hv`, `src` ("Vở ghi dd/mm/yyyy").
- Build: `python tools/build_lop.py "<thư mục này>"` (sau build_rich_words.py). Bộ từ hiện trong **Thư mục của tôi** trên trang học.
- Bỏ qua từ đã có trong bộ lớp học khác hoặc đã có giải thích đầy đủ (trùng). Từ gần nhau gộp làm một (月老 → 月下老人, 全馬 → 半馬, 口說無憑 → 憑, 敷衍了事 → 敷衍, I人 → E人, 力竭 → 竭力).
- Đợt 1 (59 từ, vở 03/11/2026) có sẵn trong `data/decks.json`. Đợt 2 (112 từ, vở 10/11, 13/11, 17/11/2026 và một trang không ghi ngày) soạn ngày 2026-11-17.

## Ngữ pháp (`ngu-phap/`)

- Mỗi file `ngu-phap/<nhóm>-NN.json` = `{"mau": [...]}`; nhóm: `a` (A1/A2), `b1`, `b2`, `c`, `kn` (khẩu ngữ Đài Loan). Các trường (`id`, `nhom`, `band`, `ten`, `zh`, `cong_thuc`, `tom_tat`, `dk1`, `dk2`, `sai`, `dung`, `vd`, `bai_tap`, `nguon`) mô tả ở đầu `tools/build_ngu_phap.py`.
- Build: `python tools/build_ngu_phap.py "<thư mục này>"` → `data/ngu-phap.json`. Trang Ngữ pháp nạp file này, thêm vào sau 8 mẫu có sẵn trong `js/app.js` (id trùng thì bỏ qua).
- Khung cấp độ: **TBCL (臺灣華語文能力基準)** của 國家教育研究院, gồm 496 điểm ngữ pháp, cấp 1–5. Quy ước: cấp 1–2 → Band A, cấp 3 → B1, cấp 4 → B2, cấp 5 → C. Cấp ghi ở `nguon` là ước lượng theo thứ tự giáo trình Đài Loan; tra lại chính xác bằng mục 語法點分級標準 trên https://coct.naer.edu.tw.
- Câu ví dụ tự soạn (không chép giáo trình hay đề thi). Mẫu có trong vở lớp học thì ghi ngày vở vào `nguon`.
- Đợt 1 (2026-11-20): 69 mẫu, gồm A1/A2: 28, B1: 21, B2: 15, khẩu ngữ: 5.
- Đợt 2 (2026-11-20): thêm 39 mẫu (A 8, B1 9, B2 10, C 12). Tổng cộng 108 mẫu, cộng 8 mẫu có sẵn trong app.

## Chép chính tả (`chinh-ta/`)

- `chinh-ta/00-goc.json`: 5 bài gốc, giữ nguyên. Câu dài 23–41 chữ, hợp nghe cả đoạn hơn.
- `chinh-ta/<band>-NN.json` = `{"bai": [...]}`. Mỗi bài có `id`, `loai` (dialogue/story/tocfl/news), `ten`, `band` (vd. "TOCFL A2 · Ăn uống"), `mo_ta`, `tu` [[từ, nghĩa]], `cau` [[người nói, câu, nghĩa]]. Mỗi bài 7–8 câu.
- **Độ dài câu** (đếm chữ Hán): Band A 5–12, B1 8–18, B2 12–24, C 14–30. Build sẽ báo câu ngoài khoảng này. Câu đáp ngắn trong hội thoại (不客氣) được giữ.
- **Người nói** quyết định giọng đọc: 小姐/女/林經理/房東/顧客/同學 → giọng nữ; 先生/男/記者/經理 → giọng nam; tên khác (旁白, 店員, 老闆) → giọng kể.
- Build: `python tools/build_chinh_ta.py "<thư mục này>"` → `data/dictation_topics.json`. Pinyin được tạo tự động.
- Đợt 1 (2026-11-20): thêm 18 bài, gồm A: 7, B1: 7, B2: 4.
- `01-goc-tach-cau.json`: 5 bài gốc đã tách thành câu ngắn, giữ id cũ và thay bản trong `00-goc.json` khi build (bản dài vẫn lưu ở `00-goc.json`). Tổng 23 bài, 198 câu.

## Mẹo nhớ `mh`: nối Hán Việt với cách đọc

Từ 2026-11-17, mỗi `mh` viết theo mẫu:

`Hán Việt → pinyin. ĐỌC: từng âm đổi thế nào (kèm thanh). NGHĨA: chữ ghép từ gì, vì sao ra nghĩa này.`

Ví dụ: `Hải Loan → hǎi wān. ĐỌC: 'hải' giữ gần nguyên (thanh 3); 'loan' bỏ L, giữ -an → wān. NGHĨA: 氵 nước + 彎 cong → chỗ nước cong vào bờ.`

Quy luật âm hay gặp (Hán Việt → pinyin):

| Hán Việt | pinyin | Ví dụ |
| --- | --- | --- |
| nh- | r- | 人 nhân rén, 忍 nhẫn rěn, 熱 nhiệt rè |
| h- (trước i, ư, ưu…) | x- | 希 hy xī, 興 hưng xīng, 學 học xué |
| t- | x- / j- / z- / q- | 心 tâm xīn, 節 tiết jié, 自 tự zì, 前 tiền qián |
| th- | sh- / t- / ch- | 生 sinh shēng, 體 thể tǐ, 成 thành chéng |
| tr-, ch- | zh- / ch- | 中 trung zhōng, 長 trưởng zhǎng, 車 xa chē |
| kh- | k- / q- | 口 khẩu kǒu, 起 khởi qǐ |
| gi-, k- (trước i) | j- | 家 gia jiā, 記 ký jì |
| c-, qu- | g- | 工 công gōng, 國 quốc guó |
| ph- | f- (đôi khi p-) | 法 pháp fǎ, 品 phẩm pǐn |
| v- | w- | 文 văn wén, 望 vọng wàng |
| d- | y- | 用 dụng yòng, 遊 du yóu |
| ng- | mất | 外 ngoại wài, 語 ngữ yǔ, 義 nghĩa yì |
| đ- | d- (dấu huyền → t-) | 大 đại dà, 同 đồng tóng, 題 đề tí |
| -ương | -ang / -iang | 方 phương fāng, 想 tưởng xiǎng |
| -iên | -ian / -an | 天 thiên tiān, 戰 chiến zhàn |
| -inh, -anh | -ing / -eng | 明 minh míng, 正 chính zhèng |
| -âm | -in / -en | 心 tâm xīn, 森 sâm sēn |

Thanh điệu: dấu huyền thường → thanh 2; dấu hỏi/ngã thường → thanh 3; dấu sắc/nặng thường → thanh 4 (nhiều ngoại lệ, ghi rõ trong `mh` khi khác).

## Bẫy Hán Việt (giống âm, khác nghĩa)

Ghi vào `lt` hoặc `mh` mỗi khi gặp. Đã ghi: 同情 (thương cảm ≠ đồng tình 同意), 博士 (tiến sĩ ≠ bác sĩ 醫生), 仔細 (kỹ lưỡng ≠ tử tế), 工作 (công việc ≠ đi công tác 出差), 房客 (người thuê ≠ phòng khách 客廳), 傷害 (làm tổn thương ≠ thương hại), 共同 (chung ≠ cộng đồng 社區), 實行 (thi hành ≠ thực hành 練習), 強調 (nhấn mạnh ≠ cường điệu 誇張), 形容 (miêu tả ≠ hình dung 想像), 答應 (nhận lời ≠ đáp ứng 滿足), 女士 (bà/cô ≠ nữ sĩ), 材料 (vật liệu ≠ tài liệu 資料), 必要 (cần thiết ≠ tất yếu), 演出 (buổi diễn ≠ diễn xuất 演技), 提高 (nâng cao ≠ đề cao), 說法 (cách nói ≠ thuyết pháp), 古蹟 (di tích ≠ cổ tích), 符合 (khớp điều kiện; 'hợp với ai' là 適合), 證明 (chứng minh; CMND là 身分證), 發達 (phát triển ≠ phát đạt làm ăn), 生產 (sản xuất ≠ sinh sản), 吸收 (hấp thụ/tiếp thu).

Bảo đảm an toàn: từ nhạy cảm (自殺, 毒品…) soạn trung tính, kèm thông tin hỗ trợ ở Đài (1925 安心專線, 110 cảnh sát, 119 cấp cứu, 165 chống lừa đảo).

## Đặc trưng Đài Loan (ghi vào `tw`)

Đơn vị đo có 公 (公尺, 公分, 公斤, 公里); 斤 = 600 g; 坪 ≈ 3,3 m²; năm Dân Quốc = năm dương lịch − 1911; 期 đọc qí; 影片 (không 視頻); 人工智慧 (không 人工智能); 品質 (không 質量); 主管/老闆 (ít dùng 領導); 講 thay 說; 好誇張喔, 滿好的, 超 + tính từ; địa chỉ chia 段; 吹冷氣 (ngồi máy lạnh); 領錢 (rút tiền ATM); 丟 hay dùng hơn 扔; 行動電源 (sạc dự phòng); cửa ghi 推/拉; 倒垃圾 chờ xe rác có nhạc.

Chữ nhiều cách đọc đã ghi: 倒 dǎo/dào, 數 shù/shǔ, 種 zhǒng/zhòng, 少 shǎo/shào, 重 chóng/zhòng, 假 jiǎ/jià, 樂 lè/yuè, 調 diào/tiáo, 曾 céng/zēng, 著 zháo/zhe, 角 jiǎo/jué, 當 dāng/dàng, 了 le/liǎo, 長 cháng/zhǎng.

## Tiến độ

Xem `TIEN-DO.md` (cập nhật sau mỗi đợt).

## Build và đưa lên

Từ thư mục repo (`C:\Users\haven\Projects\hoc-tieng-hoa-claude`):

```
python tools/build_rich.py "G:/My Drive/Mandarine Chinese/10 Website học tiếng Hoa/du-lieu-tu-vung"
```

Lệnh này tạo `data/rich/*.json` và chép thư mục nguồn vào `source/tu-vung/` trong repo. Sau đó tăng `VERSION` trong `sw.js` và `?v=` trong `index.html`, rồi commit và push.

Nghĩa ngắn ban đầu lấy từ CVDICT (CC BY-SA 4.0); phần còn lại soạn riêng. Dữ liệu phát hành theo CC BY-SA 4.0.
