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
    outputFormat?: string,
    outputFilename?: string,
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
    
    // Xác định định dạng đầu ra
    const format = outputFormat || 'png';
    // Nếu có tên file tùy chọn, sử dụng nó thay vì tempInputId
    const outputBaseName = outputFilename || `${tempInputId}_encoded`;
    const tempOutputPath = path.join(TEMP_DIR, `${outputBaseName}.${format}`);

    try {
        await fs.writeFile(tempInputPath, image.buffer);
        const encodeScriptPath = path.join(SCRIPTS_DIR, 'encode.py');

        this.logger.log(`Executing encode script for input: ${tempInputPath}`); // Log gọn hơn

        // Gọi script Python với password và thêm tham số mới nếu có
        const scriptParams = [
            encodeScriptPath, 
            tempInputPath, 
            tempOutputPath, 
            message, 
            password
        ];
        
        // Thêm tham số định dạng nếu được chỉ định
        if (outputFormat) {
            scriptParams.push(outputFormat);
            
            // Thêm tham số tên file nếu được chỉ định
            if (outputFilename) {
                scriptParams.push(outputFilename);
            }
        }
        
        // Thực thi script
        const { stdout, stderr } = await execFilePromise(
            this.pythonExecutable,
            scriptParams,
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
            } else if (stderr.includes("Image format") && stderr.includes("is not suitable")) {
                throw new BadRequestException('This image format is not suitable for steganography due to lossy compression.');
            } else if (stderr.includes("Image format") && stderr.includes("is not officially supported")) {
                throw new BadRequestException('This image format is not officially supported for steganography.');
            }
            throw new InternalServerErrorException('Failed to encode image. Check server logs.');
        }

        const encodedImagePath = stdout.trim();
         this.logger.log(`Python stdout (encode): ${encodedImagePath}`);

         if (!encodedImagePath || !encodedImagePath.includes(outputBaseName)) {
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

    let tempInputPath: string | null = null; // Đảm bảo khai báo ở phạm vi có thể truy cập trong finally/catch
    try {
        tempInputPath = path.join(TEMP_DIR, `${uuidv4()}${path.extname(image.originalname)}`);
        await fs.writeFile(tempInputPath, image.buffer);
        const decodeScriptPath = path.join(SCRIPTS_DIR, 'decode.py');
        this.logger.log(`Executing decode script for input: ${tempInputPath}`);

        // execFilePromise sẽ resolve nếu script thoát với mã 0
        // và reject nếu script thoát với mã khác 0.
        const { stdout } = await execFilePromise(
            this.pythonExecutable,
            [decodeScriptPath, tempInputPath, password],
            { encoding: 'utf8' }
        );
        // Nếu code chạy đến đây, nghĩa là script Python đã thành công (exit code 0) và không có stderr đáng kể.
        // Tuy nhiên, để cẩn thận, một số script vẫn có thể in ra stderr ngay cả khi thành công.
        // Trong trường hợp của chúng ta, lsb_util.py thiết kế để in lỗi ra stderr và exit(1).
        // Nên nếu đến đây mà có stderr thì cũng lạ, nhưng cứ để logic xử lý stderr ở catch.

        const decodedMessage = stdout.trim();
        this.logger.log(`Python stdout (decode): [message hidden in logs]`);
        this.logger.log('Decoding successful.');
        return { message: decodedMessage, tempInputPath };

    } catch (error) { // error ở đây có thể là lỗi từ fs.writeFile hoặc lỗi từ execFilePromise (khi script Python thoát với mã lỗi)
        this.logger.error(`Error during decoding execution: ${error.message}`, error.stack);

        // Kiểm tra xem lỗi có phải từ child_process và chứa stderr không
        // Thuộc tính stderr có thể nằm trong error.stderr hoặc error.message (tùy cách promisify)
        const pythonStderr = error.stderr || ''; // Lấy stderr từ lỗi, nếu có

        if (pythonStderr) {
            this.logger.error(`Python stderr (decode from caught error): ${pythonStderr}`);
            // Phân tích stderr để đưa ra lỗi cụ thể hơn
            if (pythonStderr.toLowerCase().includes("decryption failed") || pythonStderr.includes("MAC check failed") || pythonStderr.includes("Incorrect password or corrupted data")) {
                throw new BadRequestException('Decryption failed. Incorrect password or corrupted data.');
            } else if (pythonStderr.includes("End-of-message marker not found")) {
                throw new BadRequestException('No hidden message found or image data is corrupted.');
            } else if (pythonStderr.includes("file not found")) {
                 throw new InternalServerErrorException('Could not process image: Input file error.');
            } else if (pythonStderr.includes("Error opening image")) {
                 throw new BadRequestException('Invalid or corrupted image file.');
            } else if (pythonStderr.includes("Could not decode decrypted data")){
                  throw new InternalServerErrorException('Failed to decode decrypted data (possibly corrupted or not text).');
            } else if (pythonStderr.includes("Image format") && pythonStderr.includes("is not suitable")) {
                throw new BadRequestException('This image format is not suitable for steganography due to lossy compression.');
            } else if (pythonStderr.includes("Image format") && pythonStderr.includes("is not officially supported")) {
                throw new BadRequestException('This image format is not officially supported for steganography.');
            }
            // Nếu stderr có nội dung nhưng không khớp các lỗi trên, coi là lỗi script không xác định
            throw new InternalServerErrorException('Failed to decode image due to a script error. Check server logs for Python stderr.');
        }

        // Nếu lỗi không phải là lỗi từ script Python có stderr, hoặc là một lỗi khác đã được ném (ví dụ từ fs.writeFile)
        if (error instanceof BadRequestException || error instanceof InternalServerErrorException) {
            throw error; // Ném lại nếu đã là lỗi HTTP được xử lý
        }
        
        // Lỗi không mong muốn khác
        throw new InternalServerErrorException('An unexpected error occurred during decoding processing.');
    } finally {
        // Dọn dẹp file input tạm trong mọi trường hợp (thành công hoặc thất bại)
        if (tempInputPath && await fs.access(tempInputPath).then(() => true).catch(() => false)) {
            await fs.unlink(tempInputPath).catch(e => this.logger.warn(`Cleanup failed (decode finally): Could not delete ${tempInputPath}`, e.stack));
        }
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
