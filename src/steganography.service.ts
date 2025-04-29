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
    password: string,
  ): Promise<{ encodedImagePath: string; tempInputPath: string }> {
    if (!image) {
        throw new BadRequestException('Image file is required.');
    }
     if (!message) {
        throw new BadRequestException('Message is required.');
    }
     if (!password) {
         throw new BadRequestException('Password is required.');
     }

    await this.ensureTempDirExists();

    const tempInputId = uuidv4();
    const originalExt = path.extname(image.originalname);
    const tempInputPath = path.join(TEMP_DIR, `${tempInputId}${originalExt}`);
    const tempOutputPath = path.join(TEMP_DIR, `${tempInputId}_encoded.png`);

    try {
        await fs.writeFile(tempInputPath, image.buffer);
        const encodeScriptPath = path.join(SCRIPTS_DIR, 'encode.py');

        this.logger.log(`Executing encode script for input: ${tempInputPath}`); // Log gọn hơn

        // Gọi script Python với password
        const { stdout, stderr } = await execFilePromise(
            this.pythonExecutable,
            [encodeScriptPath, tempInputPath, tempOutputPath, message, password],
             { encoding: 'utf8' }
        );

        if (stderr) {
            this.logger.error(`Python stderr (encode): ${stderr}`);
            await fs.unlink(tempInputPath).catch(e => this.logger.warn(`Failed to delete temp input file: ${tempInputPath}`, e.stack));
            // Bổ sung kiểm tra lỗi mã hóa/dung lượng
             if (stderr.includes("Encryption error")) {
                 throw new InternalServerErrorException('Failed to encrypt message.');
             } else if (stderr.includes("Encrypted message + EOM is too long")) {
                throw new BadRequestException('Encrypted message is too long to hide in this image.');
            } else if (stderr.includes("Message is too long")) { // Lỗi này không nên xảy ra nữa
                throw new BadRequestException('Message is too long (pre-encryption check failed - should not happen).');
            } else if (stderr.includes("file not found")) {
                 throw new InternalServerErrorException('Could not process image: Input file error.');
            } else if (stderr.includes("Error opening image")) {
                 throw new BadRequestException('Invalid or corrupted image file.');
            }
            throw new InternalServerErrorException('Failed to encode image. Check server logs.');
        }

        const encodedImagePath = stdout.trim();
         this.logger.log(`Python stdout (encode): ${encodedImagePath}`);

         if (!encodedImagePath || !encodedImagePath.includes(tempOutputPath)) {
             this.logger.error(`Unexpected stdout from encode.py: ${stdout}`);
              await fs.unlink(tempInputPath).catch(e => this.logger.warn(`Failed to delete temp input file: ${tempInputPath}`, e.stack));
             // Cố gắng xóa output nếu script tạo ra sai đường dẫn
              if(encodedImagePath && await fs.access(encodedImagePath).then(() => true).catch(() => false)) {
                   await fs.unlink(encodedImagePath).catch(e => this.logger.warn(`Failed to delete unexpected output file: ${encodedImagePath}`, e.stack));
              }
             // Xóa cả output path dự kiến nếu nó tồn tại
             await fs.unlink(tempOutputPath).catch(e => this.logger.warn(`Failed to delete expected temp output file: ${tempOutputPath}`, e.stack));
             throw new InternalServerErrorException('Encoding script returned unexpected output.');
         }

        this.logger.log(`Encoded image saved to: ${encodedImagePath}`);
        return { encodedImagePath, tempInputPath };

    } catch (error) {
        this.logger.error(`Error during encoding: ${error.message}`, error.stack);
        await fs.unlink(tempInputPath).catch(e => this.logger.warn(`Cleanup failed (encode error): Could not delete ${tempInputPath}`, e.stack));
        await fs.unlink(tempOutputPath).catch(e => this.logger.warn(`Cleanup failed (encode error): Could not delete ${tempOutputPath}`, e.stack));
        if (error instanceof BadRequestException || error instanceof InternalServerErrorException) {
            throw error;
        }
        throw new InternalServerErrorException('An unexpected error occurred during encoding.');
    }
  }

  async decode(image: Express.Multer.File, password: string): Promise<{ message: string; tempInputPath: string }> {
     if (!image) {
        throw new BadRequestException('Image file is required.');
    }
     if (!password) {
         throw new BadRequestException('Password is required.');
     }
     await this.ensureTempDirExists();

    const tempInputId = uuidv4();
    const originalExt = path.extname(image.originalname);
    const tempInputPath = path.join(TEMP_DIR, `${tempInputId}${originalExt}`);

    try {
        await fs.writeFile(tempInputPath, image.buffer);
        const decodeScriptPath = path.join(SCRIPTS_DIR, 'decode.py');

        this.logger.log(`Executing decode script for input: ${tempInputPath}`);

        // Gọi script Python với password
        const { stdout, stderr } = await execFilePromise(
            this.pythonExecutable,
             [decodeScriptPath, tempInputPath, password],
             { encoding: 'utf8' }
             );

        if (stderr) {
            this.logger.error(`Python stderr (decode): ${stderr}`);
             await fs.unlink(tempInputPath).catch(e => this.logger.warn(`Failed to delete temp input file: ${tempInputPath}`, e.stack));
              // Phân tích lỗi giải mã/EOM
               if (stderr.includes("Decryption failed")) {
                   throw new BadRequestException('Decryption failed. Incorrect password or corrupted data.');
               } else if (stderr.includes("End-of-message marker not found")) {
                throw new BadRequestException('No hidden message found or image data is corrupted.');
              } else if (stderr.includes("file not found")) {
                 throw new InternalServerErrorException('Could not process image: Input file error.');
             } else if (stderr.includes("Error opening image")) {
                 throw new BadRequestException('Invalid or corrupted image file.');
             } else if (stderr.includes("Could not decode decrypted data")){
                  throw new InternalServerErrorException('Failed to decode decrypted data (possibly corrupted or not text).');
             }
            throw new InternalServerErrorException('Failed to decode image. Check server logs.');
        }

        const decodedMessage = stdout.trim();
         this.logger.log(`Python stdout (decode): [message hidden in logs]`); // Không log message giải mã ra

        this.logger.log('Decoding successful.');
        return { message: decodedMessage, tempInputPath };

    } catch (error) {
        this.logger.error(`Error during decoding: ${error.message}`, error.stack);
        await fs.unlink(tempInputPath).catch(e => this.logger.warn(`Cleanup failed (decode error): Could not delete ${tempInputPath}`, e.stack));
        if (error instanceof BadRequestException || error instanceof InternalServerErrorException) {
            throw error;
        }
        throw new InternalServerErrorException('An unexpected error occurred during decoding.');
    }
  }

   // Hàm tiện ích để xóa file an toàn
  async cleanupFiles(paths: string[]): Promise<void> {
    for (const filePath of paths) {
        if (filePath) { // Chỉ xóa nếu đường dẫn tồn tại
            try {
                await fs.access(filePath); // Kiểm tra file tồn tại trước khi xóa
                await fs.unlink(filePath);
                this.logger.log(`Cleaned up temp file: ${filePath}`);
             } catch (err) {
                 // Bỏ qua lỗi nếu file không tồn tại (có thể đã bị xóa hoặc chưa bao giờ tạo)
                 if (err.code !== 'ENOENT') {
                     this.logger.warn(`Failed to clean up temporary file: ${filePath}`, err.stack);
                 }
             }
        }
    }
  }
}
