import { Injectable, InternalServerErrorException, BadRequestException, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid'; // Cần cài đặt uuid: npm install uuid @types/uuid
import { promisify } from 'util';

// Chuyển execFile thành dạng Promise
const execFilePromise = promisify(execFile);

// Đường dẫn tới thư mục chứa script Python và thư mục tạm
const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts'); // Giả sử scripts ngang hàng với src
const TEMP_DIR = path.join(__dirname, '..', 'temp'); // Thư mục tạm để lưu file

@Injectable()
export class SteganographyService {
  private readonly logger = new Logger(SteganographyService.name);
  private readonly pythonExecutable = process.env.PYTHON_EXECUTABLE || 'python'; // Hoặc 'python3', tùy hệ thống

  constructor() {
    // Đảm bảo thư mục tạm tồn tại khi service khởi tạo
    fs.mkdir(TEMP_DIR, { recursive: true }).catch(err => {
        this.logger.error('Failed to create temp directory:', err);
    });
  }

  private async ensureTempDirExists(): Promise<void> {
     try {
        await fs.access(TEMP_DIR);
     } catch (error) {
        // Nếu thư mục chưa tồn tại, tạo nó
        if (error.code === 'ENOENT') {
            await fs.mkdir(TEMP_DIR, { recursive: true });
        } else {
            // Lỗi khác khi truy cập thư mục
            throw new InternalServerErrorException('Could not access temporary directory.');
        }
     }
   }


  async encode(
    image: Express.Multer.File,
    message: string,
  ): Promise<{ encodedImagePath: string; tempInputPath: string }> {
    if (!image) {
        throw new BadRequestException('Image file is required.');
    }
     if (!message) {
        throw new BadRequestException('Message is required.');
    }

    await this.ensureTempDirExists(); // Đảm bảo thư mục tạm tồn tại

    const tempInputId = uuidv4();
    const originalExt = path.extname(image.originalname);
    // Lưu file input tạm thời
    const tempInputPath = path.join(TEMP_DIR, `${tempInputId}${originalExt}`);
    // Tạo tên file output (ưu tiên .png)
    const tempOutputPath = path.join(TEMP_DIR, `${tempInputId}_encoded.png`);

    try {
        // Ghi buffer ảnh vào file tạm
        await fs.writeFile(tempInputPath, image.buffer);

        // Đường dẫn tới script encode
        const encodeScriptPath = path.join(SCRIPTS_DIR, 'encode.py');

        this.logger.log(`Executing: ${this.pythonExecutable} ${encodeScriptPath} ${tempInputPath} ${tempOutputPath} "${message.substring(0,50)}..."`); // Log rút gọn message

        // Gọi script Python
        const { stdout, stderr } = await execFilePromise(
            this.pythonExecutable,
            [encodeScriptPath, tempInputPath, tempOutputPath, message],
             { encoding: 'utf8' } // Quan trọng: Đảm bảo đọc stdout/stderr đúng encoding
        );

        if (stderr) {
            this.logger.error(`Python stderr (encode): ${stderr}`);
            // Cố gắng dọn dẹp file input
            await fs.unlink(tempInputPath).catch(e => this.logger.warn(`Failed to delete temp input file: ${tempInputPath}`, e.stack));
            // Phân tích lỗi từ Python để trả về lỗi cụ thể hơn nếu có thể
             if (stderr.includes("Message is too long")) {
                throw new BadRequestException('Message is too long to hide in this image.');
            } else if (stderr.includes("file not found")) {
                 throw new InternalServerErrorException('Could not process image: Input file error.');
            } else if (stderr.includes("Error opening image")) {
                 throw new BadRequestException('Invalid or corrupted image file.');
            }
            throw new InternalServerErrorException('Failed to encode image. Check server logs.');
        }

        // stdout mong đợi là đường dẫn file output
        const encodedImagePath = stdout.trim();
         this.logger.log(`Python stdout (encode): ${encodedImagePath}`);

        // Kiểm tra xem đường dẫn trả về có khớp không (tùy chọn)
         if (!encodedImagePath || !encodedImagePath.includes(tempOutputPath)) {
             this.logger.error(`Unexpected stdout from encode.py: ${stdout}`);
              await fs.unlink(tempInputPath).catch(e => this.logger.warn(`Failed to delete temp input file: ${tempInputPath}`, e.stack));
             await fs.unlink(tempOutputPath).catch(e => this.logger.warn(`Failed to delete temp output file: ${tempOutputPath}`, e.stack));
             throw new InternalServerErrorException('Encoding script returned unexpected output.');
         }


        this.logger.log(`Encoded image saved to: ${encodedImagePath}`);
        // Trả về đường dẫn file đã mã hóa VÀ file input tạm để controller xóa sau khi gửi response
        return { encodedImagePath, tempInputPath };

    } catch (error) {
        this.logger.error(`Error during encoding: ${error.message}`, error.stack);
        // Cố gắng dọn dẹp file nếu có lỗi
        await fs.unlink(tempInputPath).catch(e => this.logger.warn(`Cleanup failed (encode error): Could not delete ${tempInputPath}`, e.stack));
        await fs.unlink(tempOutputPath).catch(e => this.logger.warn(`Cleanup failed (encode error): Could not delete ${tempOutputPath}`, e.stack));

        if (error instanceof BadRequestException || error instanceof InternalServerErrorException) {
            throw error; // Ném lại lỗi đã được xử lý
        }
        // Lỗi không mong muốn khác (ví dụ: execFile lỗi)
        throw new InternalServerErrorException('An unexpected error occurred during encoding.');
    }
  }

  async decode(image: Express.Multer.File): Promise<{ message: string; tempInputPath: string }> {
     if (!image) {
        throw new BadRequestException('Image file is required.');
    }
     await this.ensureTempDirExists();

    const tempInputId = uuidv4();
    const originalExt = path.extname(image.originalname);
    const tempInputPath = path.join(TEMP_DIR, `${tempInputId}${originalExt}`);

    try {
        // Ghi buffer ảnh vào file tạm
        await fs.writeFile(tempInputPath, image.buffer);

        // Đường dẫn tới script decode
        const decodeScriptPath = path.join(SCRIPTS_DIR, 'decode.py');

        this.logger.log(`Executing: ${this.pythonExecutable} ${decodeScriptPath} ${tempInputPath}`);

        // Gọi script Python
        const { stdout, stderr } = await execFilePromise(
            this.pythonExecutable,
             [decodeScriptPath, tempInputPath],
             { encoding: 'utf8' }
             );

        if (stderr) {
            this.logger.error(`Python stderr (decode): ${stderr}`);
             await fs.unlink(tempInputPath).catch(e => this.logger.warn(`Failed to delete temp input file: ${tempInputPath}`, e.stack));
              if (stderr.includes("End-of-message marker not found")) {
                throw new BadRequestException('No hidden message found or image data is corrupted.');
              } else if (stderr.includes("file not found")) {
                 throw new InternalServerErrorException('Could not process image: Input file error.');
             } else if (stderr.includes("Error opening image")) {
                 throw new BadRequestException('Invalid or corrupted image file.');
             }
            throw new InternalServerErrorException('Failed to decode image. Check server logs.');
        }

        // stdout mong đợi là thông điệp giải mã
        const decodedMessage = stdout.trim();
         this.logger.log(`Python stdout (decode): ${decodedMessage.substring(0,100)}...`); // Log rút gọn


        this.logger.log('Decoding successful.');
        // Trả về thông điệp và đường dẫn file input tạm để controller xóa
        return { message: decodedMessage, tempInputPath };

    } catch (error) {
        this.logger.error(`Error during decoding: ${error.message}`, error.stack);
        // Cố gắng dọn dẹp file nếu có lỗi
        await fs.unlink(tempInputPath).catch(e => this.logger.warn(`Cleanup failed (decode error): Could not delete ${tempInputPath}`, e.stack));

         if (error instanceof BadRequestException || error instanceof InternalServerErrorException) {
            throw error; // Ném lại lỗi đã được xử lý
        }
        // Lỗi không mong muốn khác
        throw new InternalServerErrorException('An unexpected error occurred during decoding.');
    }
  }

   // Hàm tiện ích để xóa file an toàn
  async cleanupFiles(paths: string[]): Promise<void> {
    for (const filePath of paths) {
        if (filePath) { // Chỉ xóa nếu đường dẫn tồn tại
            await fs.unlink(filePath).catch(err => {
                this.logger.warn(`Failed to clean up temporary file: ${filePath}`, err.stack);
            });
        }
    }
  }
}
