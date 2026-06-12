export type UserRole = "customer" | "driver" | "operator";

export type SessionPayload = {
  userId: string;
  role: UserRole;
  fullName: string;
};
