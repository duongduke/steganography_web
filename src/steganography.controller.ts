import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  Body,
  Res,
  HttpStatus,
  ParseFilePipe,
  FileTypeValidator,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SteganographyService } from './steganography.service';
import { ApiTags, ApiConsumes, ApiBody, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import * as fs from 'fs'; // Import fs để tạo read stream
import { EncodeDto } from './dto/encode.dto'; // Import DTO mới
import { DecodeDto } from './dto/decode.dto'; // Import DTO mới

@ApiTags('steganography')
@Controller('steganography')
export class SteganographyController {
  private readonly logger = new Logger(SteganographyController.name);

  constructor(private readonly steganographyService: SteganographyService) {}

  @Post('encode')
  @UseInterceptors(FileInterceptor('image')) // 'image' là tên field trong form-data
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Image file, secret message, and password',
    schema: {
      type: 'object',
      required: ['image', 'message', 'password'],
      properties: {
        image: {
          type: 'string',
          format: 'binary',
          description: 'Image file (PNG, BMP, TIFF, or RAW recommended)',
        },
        message: {
          type: 'string',
          description: 'Secret message to hide',
        },
        password: {
          type: 'string',
          description: 'Password for encryption (min 6 characters)',
          minLength: 6,
        },
        outputFormat: {
          type: 'string',
          description: 'Output image format (default: png)',
          enum: ['png', 'bmp', 'tiff', 'raw'],
        },
        outputFilename: {
          type: 'string',
          description: 'Custom filename for output image (without extension)',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Returns the encoded image file.' })
  @ApiResponse({ status: 400, description: 'Bad Request (e.g., missing file/password, message too long, invalid image, weak password).' })
  @ApiResponse({ status: 500, description: 'Internal Server Error.' })
  async encode(
    @UploadedFile(
        new ParseFilePipe({
            validators: [
                // new MaxFileSizeValidator({ maxSize: 10000000 }), // Ví dụ: Giới hạn 10MB
                // Không giới hạn định dạng ảnh đầu vào, Python script sẽ kiểm tra
                // new FileTypeValidator({ fileType: 'image/png' }),
            ],
             fileIsRequired: true,
        }),
    )
    image: Express.Multer.File,
    @Body() body: EncodeDto, // Nhận toàn bộ body DTO (message, password, outputFormat, outputFilename)
    @Res({ passthrough: true }) res: Response, // Sử dụng passthrough để tự quản lý response
  ): Promise<any> { // Sử dụng StreamableFile thay vì any để rõ ràng hơn
    let encodedImagePath: string | null = null;
    let tempInputPath: string | null = null;
    // Lấy message, password và các tham số tùy chọn từ body DTO
    const { message, password, outputFormat, outputFilename } = body;
    try {
        // Truyền các tham số mới vào service
        const result = await this.steganographyService.encode(
            image, 
            message, 
            password, 
            outputFormat, 
            outputFilename
        );
        encodedImagePath = result.encodedImagePath;
        tempInputPath = result.tempInputPath;

        // Tạo một ReadStream từ file ảnh đã mã hóa
        const fileStream = fs.createReadStream(encodedImagePath);

        // Lấy tên file từ đường dẫn để gợi ý trình duyệt lưu file
        const filename = encodedImagePath.split(require('path').sep).pop();

        // Xác định Content-Type dựa vào định dạng file
        let contentType = 'image/png'; // Mặc định
        if (outputFormat) {
            switch(outputFormat.toLowerCase()) {
                case 'bmp':
                    contentType = 'image/bmp';
                    break;
                case 'tiff':
                    contentType = 'image/tiff';
                    break;
                case 'raw':
                    contentType = 'image/x-raw';
                    break;
                // Mặc định là PNG
            }
        }

        // Set headers để trình duyệt tải file về thay vì hiển thị
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
        res.status(HttpStatus.CREATED);

        // Pipe stream vào response
        fileStream.pipe(res);

        // Xử lý sự kiện khi stream kết thúc hoặc lỗi
        return new Promise((resolve, reject) => {
            fileStream.on('end', () => {
                this.logger.log(`Finished streaming encoded file: ${filename}`);
                resolve(undefined); // Resolve khi stream kết thúc
            });
            fileStream.on('error', (err) => {
                this.logger.error(`Error streaming encoded file: ${filename}`, err.stack);
                // Đảm bảo response chưa được gửi
                if (!res.headersSent) {
                     res.status(HttpStatus.INTERNAL_SERVER_ERROR).send('Error streaming file.');
                }
                reject(err);
            });
        });

    } catch (error) {
      // Nếu có lỗi từ service, nó sẽ được ném ra ở đây
      this.logger.error(`Encode request failed: ${error.message}`, error.stack);
      throw error; // Ném lại lỗi để Exception Filter xử lý
    } finally {
       // Dọn dẹp CẢ file input VÀ output tạm sau khi gửi response xong (hoặc nếu có lỗi)
       // Dùng setTimeout 0 để việc dọn dẹp diễn ra sau khi response hiện tại hoàn tất
       setTimeout(() => {
         const filesToClean = [tempInputPath, encodedImagePath].filter(p => p !== null) as string[];
         this.steganographyService.cleanupFiles(filesToClean)
             .catch(err => this.logger.error('Cleanup failed after encode request.', err.stack));
       }, 0);
    }
  }

  @Post('decode')
  @UseInterceptors(FileInterceptor('image'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Stego image file and password to decode',
    schema: {
      type: 'object',
      required: ['image', 'password'],
      properties: {
        image: {
          type: 'string',
          format: 'binary',
          description: 'Stego image file (PNG, BMP, TIFF, or RAW)',
        },
        password: {
          type: 'string',
          description: 'Password for decryption (min 6 characters)',
          minLength: 6,
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Returns the hidden message.', schema: { type: 'object', properties: { message: { type: 'string' } } } })
  @ApiResponse({ status: 400, description: 'Bad Request (e.g., missing file/password, incorrect password, corrupted data, invalid image).' })
  @ApiResponse({ status: 500, description: 'Internal Server Error.' })
  async decode(
     @UploadedFile(
        new ParseFilePipe({
            validators: [
                // new MaxFileSizeValidator({ maxSize: 10000000 }),
                // Không giới hạn định dạng ảnh đầu vào, Python script sẽ kiểm tra
                // new FileTypeValidator({ fileType: 'image/png' }),
            ],
            fileIsRequired: true,
        }),
    )
    image: Express.Multer.File,
    @Body() body: DecodeDto, // Nhận cả body để lấy password
  ): Promise<{ message: string }> {
    let tempInputPath: string | null = null;
    const { password } = body; // Lấy password từ body
    try {
      // Truyền password vào service
      const result = await this.steganographyService.decode(image, password);
      tempInputPath = result.tempInputPath;
      return { message: result.message };
    } catch (error) {
       this.logger.error(`Decode request failed: ${error.message}`, error.stack);
       throw error;
    } finally {
        setTimeout(() => {
           const filesToClean = [tempInputPath].filter(p => p !== null) as string[];
          this.steganographyService.cleanupFiles(filesToClean)
              .catch(err => this.logger.error('Cleanup failed after decode request.', err.stack));
        }, 0);
    }
  }
}
