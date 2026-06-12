export type BaseProfile = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string | null;
  dob: string | null;
  role: "customer" | "driver" | "operator";
  address: string | null;
  city: string | null;
  province: string | null;
  documents: string[];
  profilePhotoUrl: string | null;
  driverDetails?: DriverProfileDetails;
  operatorDetails?: OperatorProfileDetails;
  driverRating?: DriverRatingSummary;
  driverStats?: DriverStatsSummary;
  driverEarnings?: DriverEarningsSummary;
  createdAt: string | null;
};

export type DriverRatingSummary = {
  average: number | null;
  count: number;
};

export type DriverStatsSummary = {
  totalDeliveries: number;
  completedJobs: number;
  ratingAverage: number | null;
  ratingCount: number;
  memberSince: string | null;
};

export type DriverEarningsSummary = {
  today: number;
  thisWeek: number;
  thisMonth: number;
};

export type DriverProfileDetails = {
  vehicleType: string | null;
  plateNumber: string | null;
  licenseNumber: string | null;
  bankAccount: string | null;
  emergencyContact: string | null;
  documentsUploaded: {
    license: boolean;
    id: boolean;
    registration: boolean;
  };
  documents: Partial<Record<DriverDocumentType, DriverDocumentRecord>>;
};

export type DriverDocumentType = "license" | "id" | "registration";

export type OperatorProfileDetails = {
  documentsUploaded: {
    governmentId: boolean;
    businessPermit: boolean;
  };
  documents: Partial<Record<OperatorDocumentType, OperatorDocumentRecord>>;
};

export type OperatorDocumentType = "governmentId" | "businessPermit";

export type DriverDocumentRecord = {
  type: DriverDocumentType;
  fileName: string;
  mimeType: string;
  size: number;
  dataUrl: string;
  uploadedAt: string;
};

export type OperatorDocumentRecord = {
  type: OperatorDocumentType;
  fileName: string;
  mimeType: string;
  size: number;
  dataUrl: string;
  uploadedAt: string;
};

export type UpdateProfileInput = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  dob?: string;
  address?: string;
  city?: string;
  province?: string;
  documents?: string[];
  profilePhotoUrl?: string | null;
  driverDetails?: Partial<DriverProfileDetails>;
  operatorDetails?: Partial<OperatorProfileDetails>;
};
