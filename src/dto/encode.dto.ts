import { ApiProperty } from '@nestjs/swagger';

export class EncodeDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    required: true,
    description: 'Image file (PNG recommended)',
  })
  image: any; // Express.Multer.File - Swagger không hiển thị đúng nên dùng any

  @ApiProperty({
    type: 'string',
    required: true,
    description: 'Secret message to hide',
  })
  message: string;
} 