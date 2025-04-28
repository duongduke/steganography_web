import sys
from lsb_util import reveal_data

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python decode.py <stego_image_path>", file=sys.stderr)
        sys.exit(1)

    stego_img = sys.argv[1]
    reveal_data(stego_img) 