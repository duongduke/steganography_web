import sys
from PIL import Image

# Dấu hiệu kết thúc đặc biệt (end-of-message marker)
# Chuyển thành list các số nguyên (byte)
EOM_MARKER_BYTES = [0, 0, 0, 0, 0, 0, 0, 0] # 8 byte null làm dấu hiệu

def msg_to_bin(msg):
    """Chuyển đổi chuỗi thành dạng nhị phân."""
    if isinstance(msg, str):
        return ''.join(format(ord(c), '08b') for c in msg)
    elif isinstance(msg, bytes) or isinstance(msg, bytearray):
        return ''.join(format(b, '08b') for b in msg)
    elif isinstance(msg, int) or isinstance(msg, float):
         # Chuyển số thành chuỗi trước khi lấy mã nhị phân
         return ''.join(format(ord(c), '08b') for c in str(msg))
    else:
        raise TypeError("Loại dữ liệu đầu vào không được hỗ trợ")

def hide_data(image_path, secret_message, output_path):
    """Giấu dữ liệu vào ảnh."""
    try:
        img = Image.open(image_path, 'r').convert('RGB') # Đảm bảo là RGB
    except FileNotFoundError:
        print(f"Error: Input image file not found at {image_path}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error opening image: {e}", file=sys.stderr)
        sys.exit(1)

    width, height = img.size
    max_bytes = (width * height * 3) // 8 - len(EOM_MARKER_BYTES) # Tính dung lượng tối đa

    # Chuyển thông điệp bí mật và dấu hiệu kết thúc thành dạng nhị phân
    secret_message += "".join(map(chr, EOM_MARKER_BYTES)) # Thêm dấu hiệu kết thúc
    binary_secret_msg = msg_to_bin(secret_message)
    data_len = len(binary_secret_msg)

    if data_len > max_bytes * 8:
        print(f"Error: Message is too long to hide in this image. Max {max_bytes} bytes.", file=sys.stderr)
        sys.exit(1)

    data_index = 0
    img_data = list(img.getdata()) # Lấy dữ liệu pixel

    new_img_data = []

    for pixel in img_data:
        r, g, b = pixel
        new_r, new_g, new_b = r, g, b

        # Thay đổi LSB của R
        if data_index < data_len:
            new_r = (r & ~1) | int(binary_secret_msg[data_index])
            data_index += 1
        # Thay đổi LSB của G
        if data_index < data_len:
            new_g = (g & ~1) | int(binary_secret_msg[data_index])
            data_index += 1
        # Thay đổi LSB của B
        if data_index < data_len:
            new_b = (b & ~1) | int(binary_secret_msg[data_index])
            data_index += 1

        new_img_data.append((new_r, new_g, new_b))

        # Dừng nếu đã giấu hết dữ liệu
        if data_index >= data_len:
            # Thêm phần còn lại của dữ liệu ảnh gốc mà không thay đổi
            remaining_pixels = img_data[len(new_img_data):]
            new_img_data.extend(remaining_pixels)
            break # Thoát vòng lặp chính

    # Tạo ảnh mới
    new_img = Image.new(img.mode, img.size)
    new_img.putdata(new_img_data)

    try:
        # Lưu ảnh mới (ưu tiên PNG để bảo toàn LSB)
        save_format = 'PNG' if output_path.lower().endswith('.png') else img.format
        if not save_format: # Nếu ảnh gốc không có format (vd: tạo mới) -> PNG
             save_format = 'PNG'
             if not output_path.lower().endswith('.png'):
                 output_path += '.png' # Đảm bảo đuôi file là png

        new_img.save(output_path, format=save_format)
        print(output_path) # In đường dẫn file output ra stdout
    except Exception as e:
        print(f"Error saving image: {e}", file=sys.stderr)
        sys.exit(1)

def reveal_data(image_path):
    """Trích xuất dữ liệu từ ảnh."""
    try:
        img = Image.open(image_path, 'r').convert('RGB') # Đảm bảo là RGB
    except FileNotFoundError:
        print(f"Error: Input image file not found at {image_path}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error opening image: {e}", file=sys.stderr)
        sys.exit(1)

    binary_data = ""
    img_data = img.getdata()
    eom_marker_bin = msg_to_bin(bytes(EOM_MARKER_BYTES))
    eom_len = len(eom_marker_bin)

    for pixel in img_data:
        r, g, b = pixel
        binary_data += format(r, '08b')[-1] # Lấy LSB
        if len(binary_data) >= eom_len and binary_data[-eom_len:] == eom_marker_bin:
            break # Tìm thấy dấu hiệu kết thúc
        binary_data += format(g, '08b')[-1]
        if len(binary_data) >= eom_len and binary_data[-eom_len:] == eom_marker_bin:
            break
        binary_data += format(b, '08b')[-1]
        if len(binary_data) >= eom_len and binary_data[-eom_len:] == eom_marker_bin:
            break

    # Kiểm tra xem có tìm thấy dấu hiệu kết thúc không
    if not binary_data.endswith(eom_marker_bin):
         print("Error: End-of-message marker not found. Image may not contain hidden data or data is corrupted.", file=sys.stderr)
         sys.exit(1)


    # Loại bỏ dấu hiệu kết thúc
    binary_data = binary_data[:-eom_len]

    # Chuyển đổi dữ liệu nhị phân thành chuỗi
    message = ""
    for i in range(0, len(binary_data), 8):
        byte = binary_data[i:i+8]
        if len(byte) < 8: # Bỏ qua byte không hoàn chỉnh cuối cùng (nếu có)
             break
        try:
            message += chr(int(byte, 2))
        except ValueError:
             # Nếu gặp byte không hợp lệ, có thể là do lỗi hoặc hết dữ liệu
             # print(f"Warning: Skipping potentially invalid byte sequence: {byte}", file=sys.stderr)
             pass # Hoặc có thể dừng lại ở đây tùy logic mong muốn

    print(message) # In thông điệp ra stdout 