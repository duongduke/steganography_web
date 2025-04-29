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

def hide_data(image_path, secret_message, output_path, password):
    """Giấu dữ liệu đã mã hóa vào ảnh."""
    try:
        img = Image.open(image_path, 'r').convert('RGB')
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

    data_index = 0
    img_data = list(img.getdata())
    new_img_data = []

    # 5. Nhúng dữ liệu nhị phân vào LSB
    for pixel in img_data:
        r, g, b = pixel
        new_r, new_g, new_b = r, g, b
        if data_index < data_len_bits:
            new_r = (r & ~1) | int(binary_data_to_hide[data_index])
            data_index += 1
        if data_index < data_len_bits:
            new_g = (g & ~1) | int(binary_data_to_hide[data_index])
            data_index += 1
        if data_index < data_len_bits:
            new_b = (b & ~1) | int(binary_data_to_hide[data_index])
            data_index += 1
        new_img_data.append((new_r, new_g, new_b))
        if data_index >= data_len_bits:
            remaining_pixels = img_data[len(new_img_data):]
            new_img_data.extend(remaining_pixels)
            break

    # 6. Tạo và lưu ảnh mới
    new_img = Image.new(img.mode, img.size)
    new_img.putdata(new_img_data)
    try:
        save_format = 'PNG' # Luôn lưu PNG để đảm bảo LSB
        output_path_png = output_path
        if not output_path_png.lower().endswith('.png'):
             base = os.path.splitext(output_path_png)[0]
             output_path_png = base + '.png'

        new_img.save(output_path_png, format=save_format)
        print(output_path_png) # In đường dẫn file output
    except Exception as e:
        print(f"Error saving image: {e}", file=sys.stderr)
        sys.exit(1)

def reveal_data(image_path, password):
    """Trích xuất và giải mã dữ liệu từ ảnh."""
    try:
        img = Image.open(image_path, 'r').convert('RGB')
    except FileNotFoundError:
        print(f"Error: Input image file not found at {image_path}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error opening image: {e}", file=sys.stderr)
        sys.exit(1)

    binary_data = ""
    img_data = img.getdata()
    # Chuẩn bị EOM marker dạng binary để so sánh
    eom_marker_bin = msg_to_bin(bytes(EOM_MARKER_BYTES))
    eom_len = len(eom_marker_bin)

    # 1. Trích xuất LSB cho đến khi gặp EOM marker
    for pixel in img_data:
        r, g, b = pixel
        binary_data += format(r, '08b')[-1]
        if len(binary_data) >= eom_len and binary_data[-eom_len:] == eom_marker_bin:
            break
        binary_data += format(g, '08b')[-1]
        if len(binary_data) >= eom_len and binary_data[-eom_len:] == eom_marker_bin:
            break
        binary_data += format(b, '08b')[-1]
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
        byte = binary_data_extracted[i:i+8]
        # Quan trọng: Chỉ thêm nếu là byte hoàn chỉnh
        if len(byte) == 8:
            try:
                 encrypted_bytes.append(int(byte, 2))
            except ValueError:
                 # Should not happen if extraction logic is correct
                 print(f"Warning: Invalid byte sequence encountered during conversion: {byte}", file=sys.stderr)
                 continue # Bỏ qua byte lỗi
        # else: # Không nên xảy ra nếu EOM được tìm thấy đúng
             # print(f"Warning: Incomplete byte sequence at the end: {byte}", file=sys.stderr)

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