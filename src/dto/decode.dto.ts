import { ApiProperty } from '@nestjs/swagger';

export class DecodeDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    required: true,
    description: 'Stego image file (PNG recommended)',
  })
  image: any; // Express.Multer.File
} 