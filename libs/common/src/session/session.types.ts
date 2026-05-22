export type UserRole = 'customer' | 'driver' | 'operator' | 'parcel_sender';

export type SessionPayload = {
  userId: string;
  role: UserRole;
  fullName: string;
};
