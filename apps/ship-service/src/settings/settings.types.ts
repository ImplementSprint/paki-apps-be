export type SettingsRecord = {
  userId: string;
  preferences: Record<string, boolean>;
  security: {
    twoFactorEnabled: boolean;
  };
  passwordUpdatedAt: string | null;
  updatedAt: string | null;
};
