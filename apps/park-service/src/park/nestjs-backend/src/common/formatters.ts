// Booking and Review formatters

function toPlain(v: any): any {
  return v ? (v.toJSON ? v.toJSON() : v) : null;
}

function withId(obj: any): any {
  return obj ? { ...obj, _id: String(obj.id) } : null;
}

export function formatBooking(booking: any): any {
  if (!booking) return null;
  const b = toPlain(booking);
  const result: any = { ...b, _id: String(b.id) };
  if (b.userName || b.userEmail) {
    result.userId = { _id: String(b.userId), name: b.userName || '', email: b.userEmail || '', phone: b.userPhone || '' };
  } else if (b.user) {
    result.userId = withId(b.user);
  }
  if (b.vehicleBrand || b.vehiclePlate) {
    result.vehicleId = { _id: String(b.vehicleId), brand: b.vehicleBrand || '', model: b.vehicleModel || '', plateNumber: b.vehiclePlate || '', type: b.vehicleType || '', color: b.vehicleColor || '' };
  } else if (b.vehicle) {
    result.vehicleId = withId(b.vehicle);
  }
  if (b.locationName) {
    result.locationId = { _id: String(b.locationId), name: b.locationName || '', address: b.locationAddress || '' };
  } else if (b.location) {
    result.locationId = withId(b.location);
  }
  delete result.user;
  delete result.vehicle;
  delete result.location;
  delete result.parkingSlot;
  return result;
}

export function formatReview(review: any): any {
  if (!review) return null;
  const r = toPlain(review);
  const result: any = { ...r, _id: String(r.id) };
  if (r.userName) {
    result.userId = { _id: String(r.userId), name: r.userName || '', profilePicture: r.userAvatar || null };
  } else if (r.user) {
    result.userId = withId(r.user);
  }
  if (r.locationName) {
    result.locationId = { _id: String(r.locationId), name: r.locationName || '' };
  } else if (r.location) {
    result.locationId = withId(r.location);
  }
  delete result.user;
  delete result.location;
  return result;
}
