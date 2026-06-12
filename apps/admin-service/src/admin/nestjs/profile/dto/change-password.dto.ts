import { IsString, Matches, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>]).{8,}$/, {
    message: 'newPassword must have at least 8 characters, one number, and one special character',
  })
  newPassword: string;
}
