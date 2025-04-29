import sys
from lsb_util import reveal_data

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python decode.py <stego_image_path> <password>", file=sys.stderr)
        sys.exit(1)

    stego_img = sys.argv[1]
    password = sys.argv[2]

    reveal_data(stego_img, password) 