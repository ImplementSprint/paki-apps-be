import {
  Controller, Post, Get, Delete, Param, Req, Res,
  UseInterceptors, UploadedFile, UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import * as path from 'path';
import { InjectModel } from '@nestjs/sequelize';
import { UserModel } from '../models/user.model';
import { VehicleModel } from '../models/vehicle.model';
import { UploadModel } from '../models/upload.model';
import { SupabaseService } from '../common/supabase.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { ConfigService } from '@nestjs/config';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];

function storagePath(prefix: string, originalname: string): string {
  const ext = path.extname(originalname).toLowerCase() || '.bin';
  return `${prefix}/${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
}

const multerConfig = {
  storage: memoryStorage(),
  fileFilter: (_req: any, file: any, cb: any) => {
    if (ALLOWED_MIME.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`File type not allowed: ${file.mimetype}`), false);
  },
  limits: { fileSize: 5 * 1024 * 1024 },
};

@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadController {
  private avatarBucket: string;
  private vehicleBucket: string;

  constructor(
    @InjectModel(UserModel) private userModel: typeof UserModel,
    @InjectModel(VehicleModel) private vehicleModel: typeof VehicleModel,
    @InjectModel(UploadModel) private uploadModel: typeof UploadModel,
    private supabase: SupabaseService,
    private cfg: ConfigService,
  ) {
    this.avatarBucket = cfg.get('SUPABASE_AVATAR_BUCKET') || 'avatars';
    this.vehicleBucket = cfg.get('SUPABASE_VEHICLE_BUCKET') || 'vehicle-docs';
  }

  @Post('avatar')
  @UseInterceptors(FileInterceptor('avatar', multerConfig))
  async uploadAvatar(@Req() req: any, @UploadedFile() file: Express.Multer.File) {
    try {
      if (!file) return { success: false, message: 'No file uploaded' };
      const filePath = storagePath(`user-${req.user.id}`, file.originalname);
      const url = await this.supabase.uploadFile(this.avatarBucket, filePath, file.buffer, file.mimetype);
      const upload = await this.uploadModel.create({ userId: req.user.id, entityType: 'user_avatar', entityId: req.user.id, filename: filePath, originalName: file.originalname, mimeType: file.mimetype, size: file.size, url });
      const user = await this.userModel.findByPk(req.user.id);
      if (user) await user.update({ profilePicture: url });
      return { success: true, data: { url, upload: upload.toJSON() } };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Post('vehicle/:vehicleId/or')
  @UseInterceptors(FileInterceptor('orDoc', multerConfig))
  async uploadOrDoc(@Req() req: any, @Param('vehicleId') vehicleId: string, @UploadedFile() file: Express.Multer.File) {
    try {
      if (!file) return { success: false, message: 'No file uploaded' };
      const vid = parseInt(vehicleId);
      const vehicle = await this.vehicleModel.findOne({ where: { id: vid, userId: req.user.id } });
      if (!vehicle) return { success: false, message: 'Vehicle not found' };
      const filePath = storagePath(`user-${req.user.id}/vehicle-${vid}`, file.originalname);
      const url = await this.supabase.uploadFile(this.vehicleBucket, filePath, file.buffer, file.mimetype);
      const upload = await this.uploadModel.create({ userId: req.user.id, entityType: 'vehicle_or', entityId: vid, filename: filePath, originalName: file.originalname, mimeType: file.mimetype, size: file.size, url });
      await vehicle.update({ orDoc: url });
      return { success: true, data: { url, upload: upload.toJSON() } };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Post('vehicle/:vehicleId/cr')
  @UseInterceptors(FileInterceptor('crDoc', multerConfig))
  async uploadCrDoc(@Req() req: any, @Param('vehicleId') vehicleId: string, @UploadedFile() file: Express.Multer.File) {
    try {
      if (!file) return { success: false, message: 'No file uploaded' };
      const vid = parseInt(vehicleId);
      const vehicle = await this.vehicleModel.findOne({ where: { id: vid, userId: req.user.id } });
      if (!vehicle) return { success: false, message: 'Vehicle not found' };
      const filePath = storagePath(`user-${req.user.id}/vehicle-${vid}`, file.originalname);
      const url = await this.supabase.uploadFile(this.vehicleBucket, filePath, file.buffer, file.mimetype);
      const upload = await this.uploadModel.create({ userId: req.user.id, entityType: 'vehicle_cr', entityId: vid, filename: filePath, originalName: file.originalname, mimeType: file.mimetype, size: file.size, url });
      await vehicle.update({ crDoc: url });
      return { success: true, data: { url, upload: upload.toJSON() } };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Get('my')
  async getMyUploads(@Req() req: any) {
    try {
      const uploads = await this.uploadModel.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']] });
      return { success: true, data: uploads.map((u) => u.toJSON()) };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Delete(':id')
  async deleteUpload(@Param('id') id: string, @Req() req: any) {
    try {
      const record = await this.uploadModel.findOne({ where: { id: parseInt(id), userId: req.user.id } });
      if (!record) return { success: false, message: 'Upload not found' };
      const bucket = (record as any).entityType === 'user_avatar' ? this.avatarBucket : this.vehicleBucket;
      try { await this.supabase.deleteFile(bucket, (record as any).filename); } catch (e) { console.warn('[Upload] Storage delete skipped:', e.message); }
      await record.destroy();
      return { success: true, message: 'File deleted' };
    } catch (e) { return { success: false, message: e.message }; }
  }
}
