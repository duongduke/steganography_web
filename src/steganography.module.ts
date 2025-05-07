import { Module } from '@nestjs/common';
import { SteganographyController } from './steganography.controller';
import { SteganographyService } from './steganography.service';

@Module({
  controllers: [SteganographyController],
  providers: [SteganographyService],
  exports: [SteganographyService]
})
export class SteganographyModule {}
