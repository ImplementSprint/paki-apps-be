export type NotificationType = "delivery" | "system" | "promo";

export type UserNotification = {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string | null;
};
