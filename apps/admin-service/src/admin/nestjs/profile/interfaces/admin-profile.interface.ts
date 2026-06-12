export interface AdminProfile {
  address: string;
  adminId: string;
  dob: string;
  email: string;
  lastLogin: string;
  name: string;
  phone: string;
  profilePicture: string | null;
  role: 'Admin';
}

export interface StoredAdminProfile extends AdminProfile {
  passwordHash: string;
  passwordSalt: string;
  updatedAt: string;
}
