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
- Mỗi từ có 3 câu ví dụ, ít nhất 2 câu chứa đúng từ đó (câu thứ 2 dùng cho thẻ Điền từ).
- Hội thoại dùng được càng nhiều từ của bài càng tốt.
- Pinyin không cần viết: lúc build, script tự tạo (ưu tiên cách đọc Đài Loan trong bảng TOCFL). Nếu một câu bị đọc sai, thêm `"py": "..."` vào câu đó.

## Build và đưa lên

Từ thư mục repo (`C:\Users\haven\Projects\hoc-tieng-hoa-claude`):

```
python tools/build_rich.py "G:/My Drive/Mandarine Chinese/10 Website học tiếng Hoa/du-lieu-tu-vung"
```

Lệnh này tạo `data/rich/*.json` và chép thư mục nguồn vào `source/tu-vung/` trong repo. Sau đó tăng `VERSION` trong `sw.js` và `?v=` trong `index.html`, rồi commit và push.

Nghĩa ngắn ban đầu lấy từ CVDICT (CC BY-SA 4.0); phần còn lại soạn riêng. Dữ liệu phát hành theo CC BY-SA 4.0.
