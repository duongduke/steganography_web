import sys
import os
from lsb_util import hide_data

if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python encode.py <input_image_path> <output_image_path> \"<secret_message>\"", file=sys.stderr)
        sys.exit(1)

    input_img = sys.argv[1]
    output_img = sys.argv[2]
    message = sys.argv[3]

    # Đảm bảo thư mục output tồn tại
    output_dir = os.path.dirname(output_img)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    hide_data(input_img, message, output_img) 