import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiCenterService } from '../common/api-center.service';

@Injectable()
export class PaymentService {
  constructor(private cfg: ConfigService, private apiCenter: ApiCenterService) {}

  async createCheckoutSession(opts: any): Promise<any> {
    const { amount, referenceId, description, currency = 'PHP', successUrl, cancelUrl, method = 'GCash' } = opts;
    const sUrl = successUrl || (this.cfg.get('CLIENT_URL') + `/customer/book?step=receipt&reference=${referenceId}`);
    const cUrl = cancelUrl || (this.cfg.get('CLIENT_URL') + `/customer/book?step=payment-failed&reference=${referenceId}`);
    console.log(`[Payment] Creating checkout | ref: ${referenceId} | ₱${amount}`);
    try {
      const body: any = {
        referenceId, idempotencyKey: `checkout-${referenceId}-${Date.now()}`,
        successUrl: sUrl, cancelUrl: cUrl,
        paymentMethods: [method.toLowerCase()],
        lineItems: [{ name: description || 'PakiPark Parking Reservation', quantity: 1, amount: { value: Math.round(amount * 100), currency } }],
      };
      const sk = this.cfg.get('PAYMONGO_SECRET_KEY');
      const pk = this.cfg.get('PAYMONGO_PUBLIC_KEY');
      if (sk && pk) { body.paymongoSecretKey = sk; body.paymongoPublicKey = pk; body.credentials = { secretKey: sk, publicKey: pk }; }
      const response = await this.apiCenter.post('/shared/payment/checkout/sessions', body);
      const payload = response.data || response;
      return { sessionId: payload.checkoutId || payload.id, checkoutUrl: payload.redirectUrl || payload.url || payload.checkout_url, status: payload.status || 'pending', expiresAt: payload.expiresAt || payload.expires_at || null };
    } catch (err) {
      console.error('[Payment] Checkout failed:', err.message);
      if (this.cfg.get('NODE_ENV') !== 'production') {
        return { sessionId: `mock-${referenceId}-${Date.now()}`, checkoutUrl: `${this.cfg.get('CLIENT_URL') || 'http://localhost:3000'}/mock-payment?ref=${referenceId}&amount=${amount}`, status: 'pending', expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), isMock: true };
      }
      throw new Error('Payment gateway unavailable. Please try again shortly.');
    }
  }

  async getPaymentStatus(sessionId: string): Promise<any> {
    if (sessionId.startsWith('mock-')) return { sessionId, status: 'paid', amount: 0, paidAt: new Date().toISOString(), isMock: true };
    const response = await this.apiCenter.get(`/shared/payment/checkout/sessions/${sessionId}`);
    const payload = response.data || response;
    const rawAmount = payload.amount && typeof payload.amount === 'object' ? payload.amount.value : payload.amount;
    return { sessionId, status: payload.status, amount: (rawAmount || 0) / 100, paidAt: payload.paidAt || payload.paid_at || null };
  }

  async refundPayment(sessionId: string, amount?: number, reason = 'Customer request'): Promise<any> {
    if (sessionId.startsWith('mock-')) return { refundId: `mock-refund-${Date.now()}`, status: 'refunded', amount: amount || 0, isMock: true };
    try {
      const body: any = { reason };
      if (amount !== undefined) body.amount = Math.round(amount * 100);
      const response = await this.apiCenter.post(`/shared/payment/checkout/sessions/${sessionId}/refund`, body);
      const payload = response.data || response;
      const rawAmount = payload.amount && typeof payload.amount === 'object' ? payload.amount.value : payload.amount;
      return { refundId: payload.refundId || payload.id, status: payload.status || 'refunded', amount: (rawAmount || 0) / 100 };
    } catch (err) {
      if (this.cfg.get('NODE_ENV') !== 'production') return { refundId: `mock-refund-${Date.now()}`, status: 'refunded', amount: amount || 0, isMock: true };
      throw new Error('Refund request failed. Please contact support.');
    }
  }
}
