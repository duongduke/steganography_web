import sys
import os # Thêm os để dùng urandom
from PIL import Image
from Crypto.Cipher import AES
from Crypto.Protocol.KDF import PBKDF2
from Crypto.Hash import SHA256
from Crypto.Random import get_random_bytes

# Dấu hiệu kết thúc đặc biệt (end-of-message marker)
# Chuyển thành list các số nguyên (byte)
EOM_MARKER_BYTES = [0, 0, 0, 0, 0, 0, 0, 0] # 8 byte null làm dấu hiệu

# Định dạng ảnh hỗ trợ và các tùy chọn đặc biệt cho từng định dạng
SUPPORTED_FORMATS = ['PNG', 'BMP', 'TIFF', 'RAW']
LOSSY_FORMATS = ['JPEG', 'JPG', 'WEBP', 'HEIF', 'HEIC', 'AVIF']

# Cấu hình lưu cho các định dạng khác nhau
FORMAT_SAVE_OPTIONS = {
    'TIFF': {'compression': 'raw'}, # Không nén cho TIFF
    'PNG': {'compress_level': 0},   # Mức nén thấp nhất cho PNG
    'BMP': {},                      # Không có tùy chọn đặc biệt cho BMP
    'RAW': {},                      # Không có tùy chọn đặc biệt cho RAW
}

# Thêm header để nhận dạng dữ liệu ẩn
STEGO_HEADER = b'STEGO'
HEADER_VERSION = 1  # Phiên bản của thuật toán

# --- AES Encryption/Decryption Functions ---
SALT_SIZE = 16 # Kích thước salt cho PBKDF2
KEY_SIZE = 32 # Kích thước khóa AES (256-bit)
ITERATIONS = 100000 # Số vòng lặp cho PBKDF2 (tăng bảo mật)

def derive_key(password: str, salt: bytes) -> bytes:
    """Tạo khóa AES từ mật khẩu và salt bằng PBKDF2."""
    return PBKDF2(password.encode('utf-8'), salt, dkLen=KEY_SIZE, count=ITERATIONS, hmac_hash_module=SHA256)

def encrypt_aes_gcm(data: bytes, password: str) -> bytes:
    """Mã hóa dữ liệu bằng AES-GCM."""
    salt = get_random_bytes(SALT_SIZE)
    key = derive_key(password, salt)
    cipher = AES.new(key, AES.MODE_GCM) # Tạo nonce ngẫu nhiên
    ciphertext, tag = cipher.encrypt_and_digest(data)
    # Trả về salt + nonce + tag + ciphertext
    # Nonce và Tag đều quan trọng để giải mã và xác thực
    return salt + cipher.nonce + tag + ciphertext

def decrypt_aes_gcm(encrypted_data: bytes, password: str) -> bytes:
    """Giải mã dữ liệu AES-GCM."""
    try:
        salt = encrypted_data[:SALT_SIZE]
        nonce_start = SALT_SIZE
        # Kích thước nonce mặc định của GCM là 16 bytes (128 bits)
        # Kích thước tag mặc định của GCM cũng là 16 bytes (128 bits)
        nonce_end = nonce_start + 16
        tag_start = nonce_end
        tag_end = tag_start + 16
        ciphertext_start = tag_end

        nonce = encrypted_data[nonce_start:nonce_end]
        tag = encrypted_data[tag_start:tag_end]
        ciphertext = encrypted_data[ciphertext_start:]

        key = derive_key(password, salt)
        cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)

        # Giải mã và xác thực (verify tag)
        decrypted_data = cipher.decrypt_and_verify(ciphertext, tag)
        return decrypted_data
    except (ValueError, KeyError, IndexError) as e:
        # Lỗi xảy ra nếu dữ liệu bị hỏng, sai key, hoặc sai cấu trúc
        print(f"Decryption error: {e}", file=sys.stderr)
        raise ValueError("Decryption failed. Incorrect password or corrupted data.")

# --- LSB Functions (modified) ---

def msg_to_bin(msg):
    """Chuyển đổi bytes thành dạng nhị phân."""
    # Chỉ xử lý bytes sau khi mã hóa
    if isinstance(msg, bytes) or isinstance(msg, bytearray):
        return ''.join(format(b, '08b') for b in msg)
    else:
        # Các loại khác không còn được hỗ trợ trực tiếp ở đây
        # vì đầu vào luôn là bytes đã mã hóa
        raise TypeError("Input must be bytes or bytearray")

def check_image_format(image_path):
    """Kiểm tra định dạng ảnh và trả về thông tin về khả năng hỗ trợ LSB."""
    try:
        img = Image.open(image_path)
        img_format = img.format
        
        if img_format in SUPPORTED_FORMATS:
            return True, f"Image format {img_format} is supported for LSB steganography."
        elif img_format in LOSSY_FORMATS:
            return False, f"Image format {img_format} is not suitable for LSB steganography due to lossy compression."
        else:
            return False, f"Image format {img_format} is not officially supported for LSB steganography."
    except FileNotFoundError:
        return False, f"Error: Input image file not found at {image_path}"
    except Exception as e:
        return False, f"Error opening image: {e}"

def hide_data(image_path, secret_message, output_path, password, output_format="png"):
    """Giấu dữ liệu đã mã hóa vào ảnh."""
    # Kiểm tra định dạng ảnh đầu vào
    is_supported, message = check_image_format(image_path)
    if not is_supported:
        print(message, file=sys.stderr)
        sys.exit(1)
        
    try:
        # Mở ảnh và chuyển thành RGB, không quan tâm đến alpha channel
        img = Image.open(image_path).convert('RGB')
    except FileNotFoundError:
        print(f"Error: Input image file not found at {image_path}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error opening image: {e}", file=sys.stderr)
        sys.exit(1)

    width, height = img.size
    # Dung lượng tối đa tính theo byte
    max_bytes_capacity = (width * height * 3) // 8

    try:
        # 1. Mã hóa thông điệp (chuyển thành bytes nếu là string)
        message_bytes = secret_message.encode('utf-8') if isinstance(secret_message, str) else secret_message
        encrypted_message = encrypt_aes_gcm(message_bytes, password)
    except Exception as e:
        print(f"Encryption error: {e}", file=sys.stderr)
        sys.exit(1)

    # 2. Thêm dấu hiệu kết thúc SAU KHI mã hóa
    data_to_hide = encrypted_message + bytes(EOM_MARKER_BYTES)

    # 3. Chuyển dữ liệu cần giấu (đã mã hóa + EOM) thành nhị phân
    binary_data_to_hide = msg_to_bin(data_to_hide)
    data_len_bits = len(binary_data_to_hide)

    # 4. Kiểm tra dung lượng (tính theo bit)
    if data_len_bits > max_bytes_capacity * 8:
        print(f"Error: Encrypted message + EOM is too long ({len(data_to_hide)} bytes). Max capacity: {max_bytes_capacity} bytes.", file=sys.stderr)
        sys.exit(1)

    # 5. Tạo một bản sao của ảnh gốc để làm việc
    new_img = Image.new('RGB', img.size)
    pixels = list(img.getdata())
    new_pixels = []
    data_index = 0

    # 6. Nhúng dữ liệu nhị phân vào LSB
    for i, pixel in enumerate(pixels):
        r, g, b = pixel
        new_r, new_g, new_b = r, g, b

        # Chỉ thay đổi các pixel cho đến khi tất cả dữ liệu được nhúng
        if data_index < data_len_bits:
            new_r = (r & ~1) | int(binary_data_to_hide[data_index])
            data_index += 1
        
        if data_index < data_len_bits:
            new_g = (g & ~1) | int(binary_data_to_hide[data_index])
            data_index += 1
            
        if data_index < data_len_bits:
            new_b = (b & ~1) | int(binary_data_to_hide[data_index])
            data_index += 1
            
        new_pixels.append((new_r, new_g, new_b))
        
        # Nếu đã nhúng hết dữ liệu, giữ nguyên các pixel còn lại
        if data_index >= data_len_bits and i < len(pixels) - 1:
            new_pixels.extend(pixels[i+1:])
            break

    # 7. Đặt dữ liệu pixel mới cho ảnh
    new_img.putdata(new_pixels)

    try:
        # Xác định định dạng đầu ra
        output_format = output_format.upper()
        if output_format not in SUPPORTED_FORMATS:
            print(f"Warning: Unsupported output format '{output_format}'. Using PNG as default.", file=sys.stderr)
            output_format = "PNG"
            
        # Đảm bảo phần mở rộng file đúng với định dạng
        base, ext = os.path.splitext(output_path)
        correct_ext = f".{output_format.lower()}"
        
        # Nếu không có phần mở rộng hoặc phần mở rộng không khớp với định dạng, sửa lại
        if not ext or ext.lower() != correct_ext:
            output_path = base + correct_ext

        # Lấy tùy chọn lưu trữ cho định dạng được chọn
        save_options = FORMAT_SAVE_OPTIONS.get(output_format, {})
        
        # Đối với TIFF, đảm bảo lưu ở chế độ không nén để giữ nguyên LSB
        if output_format == 'TIFF':
            new_img.save(output_path, format=output_format, compression='raw')
        else:
            # Đối với các định dạng khác, sử dụng tùy chọn mặc định
            new_img.save(output_path, format=output_format, **save_options)
            
        print(output_path) # In đường dẫn file output
    except Exception as e:
        print(f"Error saving image: {e}", file=sys.stderr)
        sys.exit(1)

def reveal_data(image_path, password):
    """Trích xuất và giải mã dữ liệu từ ảnh."""
    # Kiểm tra định dạng ảnh đầu vào
    is_supported, message = check_image_format(image_path)
    if not is_supported:
        print(message, file=sys.stderr)
        sys.exit(1)
        
    try:
        img = Image.open(image_path).convert('RGB')
    except FileNotFoundError:
        print(f"Error: Input image file not found at {image_path}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error opening image: {e}", file=sys.stderr)
        sys.exit(1)

    binary_data = ""
    pixels = img.getdata()
    # Chuẩn bị EOM marker dạng binary để so sánh
    eom_marker_bin = msg_to_bin(bytes(EOM_MARKER_BYTES))
    eom_len = len(eom_marker_bin)

    # 1. Trích xuất LSB cho đến khi gặp EOM marker
    for pixel in pixels:
        r, g, b = pixel
        binary_data += str(r & 1)  # Lấy LSB của kênh đỏ
        if len(binary_data) >= eom_len and binary_data[-eom_len:] == eom_marker_bin:
            break
            
        binary_data += str(g & 1)  # Lấy LSB của kênh xanh lá
        if len(binary_data) >= eom_len and binary_data[-eom_len:] == eom_marker_bin:
            break
            
        binary_data += str(b & 1)  # Lấy LSB của kênh xanh dương
        if len(binary_data) >= eom_len and binary_data[-eom_len:] == eom_marker_bin:
            break

    if not binary_data.endswith(eom_marker_bin):
         print("Error: End-of-message marker not found.", file=sys.stderr)
         sys.exit(1)

    # 2. Loại bỏ EOM marker (phần cuối)
    binary_data_extracted = binary_data[:-eom_len]

    # 3. Chuyển chuỗi bit trích xuất thành bytes
    encrypted_bytes = bytearray()
    for i in range(0, len(binary_data_extracted), 8):
        # Chỉ xử lý đủ 8 bit tạo thành 1 byte
        if i + 8 <= len(binary_data_extracted):
            byte = binary_data_extracted[i:i+8]
            try:
                encrypted_bytes.append(int(byte, 2))
            except ValueError:
                print(f"Warning: Invalid byte sequence encountered: {byte}", file=sys.stderr)
                # Bỏ qua byte lỗi và tiếp tục
                continue

    if not encrypted_bytes:
         print("Error: No valid encrypted data could be extracted before EOM.", file=sys.stderr)
         sys.exit(1)

    # 4. Giải mã dữ liệu bytes
    try:
        decrypted_message_bytes = decrypt_aes_gcm(bytes(encrypted_bytes), password)
        # 5. Chuyển bytes đã giải mã thành chuỗi (giả sử UTF-8)
        message = decrypted_message_bytes.decode('utf-8')
        print(message) # In thông điệp gốc ra stdout
    except ValueError as e:
        # Lỗi từ decrypt_aes_gcm (sai pass, dữ liệu hỏng)
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except UnicodeDecodeError:
         print("Error: Could not decode decrypted data to UTF-8 string. Data might be corrupted or not text.", file=sys.stderr)
         sys.exit(1)
    except Exception as e:
        print(f"Unexpected error during decryption or decoding: {e}", file=sys.stderr)
        sys.exit(1)