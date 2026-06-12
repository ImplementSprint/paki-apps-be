import { Body, Controller, Delete, Get, Patch } from '@nestjs/common';

import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfilePhotoDto } from './dto/update-profile-photo.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileService } from './profile.service';

@Controller('pakiship/profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  getProfile() {
    return this.profileService.getProfile();
  }

  @Patch()
  updateProfile(@Body() dto: UpdateProfileDto) {
    return this.profileService.updateProfile(dto);
  }

  @Patch('photo')
  updatePhoto(@Body() dto: UpdateProfilePhotoDto) {
    return this.profileService.updatePhoto(dto);
  }

  @Delete('photo')
  removePhoto() {
    return this.profileService.removePhoto();
  }

  @Patch('password')
  changePassword(@Body() dto: ChangePasswordDto) {
    return this.profileService.changePassword(dto);
  }
}
