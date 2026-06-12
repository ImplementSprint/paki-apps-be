import { IsString, Matches, MaxLength } from 'class-validator';

export class UpdateProfilePhotoDto {
  @IsString()
  @MaxLength(1_500_000)
  @Matches(/^data:image\/(png|jpeg|jpg|webp);base64,/, {
    message: 'profilePicture must be a base64 data URL for png, jpeg, jpg, or webp',
  })
  profilePicture: string;
}
