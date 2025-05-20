import sys
import os
from lsb_util import hide_data

if __name__ == "__main__":
    # Kiểm tra tham số đầu vào
    # 1. Trường hợp cơ bản: 5 tham số (script, input, output, message, password)
    # 2. Trường hợp mở rộng: 6 tham số (thêm output_format)
    # 3. Trường hợp đầy đủ: 7 tham số (thêm cả output_filename)
    if len(sys.argv) < 5:
        print("Usage: python encode.py <input_image_path> <output_image_path> \"<secret_message>\" <password> [output_format] [output_filename]", file=sys.stderr)
        sys.exit(1)

    input_img = sys.argv[1]
    output_img = sys.argv[2]
    message = sys.argv[3]
    password = sys.argv[4]
    
    # Xử lý tham số tùy chọn
    output_format = "png"  # Mặc định là PNG
    if len(sys.argv) >= 6:
        output_format = sys.argv[5].lower()
    
    # Xử lý tham số tên file tùy chọn
    if len(sys.argv) >= 7 and sys.argv[6]:
        output_filename = sys.argv[6]
        # Tạo đường dẫn output mới với tên file được chỉ định
        output_dir = os.path.dirname(output_img)
        # Sử dụng tên file mới nhưng giữ nguyên định dạng
        output_img = os.path.join(output_dir, f"{output_filename}.{output_format}")

    # Đảm bảo thư mục output tồn tại
    output_dir = os.path.dirname(output_img)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    # Truyền thêm tham số output_format
    hide_data(input_img, message, output_img, password, output_format) 