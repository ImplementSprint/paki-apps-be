import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TribeClient } from '@implementsprint/sdk';

@Injectable()
export class PaymentService {
  private readonly client: TribeClient;

  constructor(private readonly configService: ConfigService) {
    this.client = new TribeClient({
      gatewayUrl: this.configService.get<string>('APICENTER_URL') || 'https://api-center-test.itsandbox.site',
      tribeId: this.configService.get<string>('APICENTER_TRIBE_ID') || 'pakiapps',
      secret: this.configService.get<string>('APICENTER_TRIBE_SECRET') || '',
    });
  }

  async processCheckout(body: { draftId: string; price: number }) {
    return this.createEwalletCheckout(body.draftId, body.price);
  }

  async createEwalletCheckout(draftId: string, price: number) {
    try {
      await this.client.authenticate();

      const checkout = await this.client.paymentCreateCheckoutSession({
        referenceId: `draft-${draftId}`,
        idempotencyKey: `checkout-${draftId}-${Date.now()}`,
        successUrl: `pakiship://payment-success?draftId=${draftId}`,
        cancelUrl: `pakiship://payment-cancel?draftId=${draftId}`,
        paymentMethods: ['gcash', 'maya', 'qrph'],
        lineItems: [
          {
            name: 'PakiShip Parcel Delivery',
            quantity: 1,
            amount: { value: Math.round(price * 100), currency: 'PHP' },
          },
        ],
      });
      console.log("[PaymentService] Successfully got response from SDK:", checkout);

      return checkout;
    } catch (error) {
      console.error("APICenter Payment Error:", error);
      throw new InternalServerErrorException("Failed to generate payment link.");
    }
  }
}
