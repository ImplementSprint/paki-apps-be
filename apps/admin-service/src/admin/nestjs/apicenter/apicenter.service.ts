import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

export interface PublishTribeEventDto {
  sourceServiceId: string;
  key: string;
  eventType: string;
  payload: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface KafkaPublishDto {
  topic: string;
  sourceServiceId: string;
  key: string;
  eventType: string;
  payload: Record<string, any>;
  metadata?: Record<string, any>;
}

@Injectable()
export class ApicenterService implements OnModuleInit {
  private readonly logger = new Logger('ApicenterService');
  private client: any = null;
  private isSdkAvailable = false;
  private isConfigured = false;

  private readonly gatewayUrl = process.env.APICENTER_URL;
  private readonly tribeId = process.env.APICENTER_TRIBE_ID;
  private readonly sourceServiceId = process.env.APICENTER_SERVICE_ID;
  private readonly secret = process.env.APICENTER_TRIBE_SECRET;

  async onModuleInit() {
    this.logger.log('Initializing APICenter SDK Client...');
    
    // Check if configuration exists
    if (!this.gatewayUrl || !this.tribeId || !this.secret) {
      this.logger.warn(
        'APICenter configuration is incomplete in environment. Missing APICENTER_URL, APICENTER_TRIBE_ID, or APICENTER_TRIBE_SECRET.'
      );
      this.logger.warn('Running in Mock/Development Event Logging mode.');
      return;
    }

    this.isConfigured = true;

    try {
      // Dynamically attempt to import @implementsprint/sdk
      const sdkModule = await import('@implementsprint/sdk');
      const TribeClient = sdkModule.TribeClient;
      
      if (TribeClient) {
        this.client = new TribeClient({
          gatewayUrl: this.gatewayUrl,
          tribeId: this.tribeId,
          sourceServiceId: this.sourceServiceId || 'pakiship-admin',
          secret: this.secret,
        });
        
        this.isSdkAvailable = true;
        this.logger.log(`Successfully loaded @implementsprint/sdk. Attempting to authenticate with APICenter at ${this.gatewayUrl}...`);
        
        // Authenticate client
        await this.client.authenticate();
        this.logger.log('APICenter SDK Client successfully authenticated!');
      }
    } catch (error) {
      this.logger.warn(
        `Could not load or authenticate @implementsprint/sdk: ${(error as Error).message}.`
      );
      this.logger.warn('Event publishing will fall back to Mock/Development Event Logging.');
      this.isSdkAvailable = false;
    }
  }

  /**
   * Publish a business event to tribe.<tribe_id>.events topic
   */
  async publishTribeEvent(dto: PublishTribeEventDto) {
    const occurredAt = dto.payload.occurredAt || new Date().toISOString();
    const eventPayload = {
      ...dto.payload,
      occurredAt,
    };

    const finalDto = {
      sourceServiceId: dto.sourceServiceId || this.sourceServiceId || 'pakiship-admin',
      key: dto.key,
      eventType: dto.eventType,
      payload: eventPayload,
      metadata: dto.metadata || { schemaVersion: '1' },
    };

    if (this.isSdkAvailable && this.client) {
      try {
        this.logger.log(`Publishing governed Kafka event '${dto.eventType}' to APICenter...`);
        const result = await this.client.publishTribeEvent(finalDto);
        this.logger.log(`Event published successfully: ${JSON.stringify(result)}`);
        return result;
      } catch (error) {
        this.logger.error(`Failed to publish event to APICenter: ${(error as Error).message}`);
        this.logMockPublish(finalDto, (error as Error).message);
        return { accepted: false, error: (error as Error).message };
      }
    } else {
      this.logMockPublish(finalDto);
      return {
        accepted: true,
        mock: true,
        topic: `tribe.${this.tribeId || 'pakiship'}.events`,
        eventType: dto.eventType,
      };
    }
  }

  /**
   * Explicitly publish to a governed Kafka topic
   */
  async kafkaPublish(dto: KafkaPublishDto) {
    const occurredAt = dto.payload.occurredAt || new Date().toISOString();
    const eventPayload = {
      ...dto.payload,
      occurredAt,
    };

    const finalDto = {
      topic: dto.topic,
      sourceServiceId: dto.sourceServiceId || this.sourceServiceId || 'pakiship-admin',
      key: dto.key,
      eventType: dto.eventType,
      payload: eventPayload,
      metadata: dto.metadata || { schemaVersion: '1' },
    };

    if (this.isSdkAvailable && this.client) {
      try {
        this.logger.log(`Explicitly publishing event to Kafka topic '${dto.topic}' via APICenter...`);
        const result = await this.client.kafkaPublish(finalDto);
        this.logger.log(`Kafka event published successfully: ${JSON.stringify(result)}`);
        return result;
      } catch (error) {
        this.logger.error(`Failed to explicitly publish Kafka event: ${(error as Error).message}`);
        this.logMockPublish(finalDto, (error as Error).message);
        return { accepted: false, error: (error as Error).message };
      }
    } else {
      this.logMockPublish(finalDto);
      return {
        accepted: true,
        mock: true,
        topic: dto.topic,
        eventType: dto.eventType,
      };
    }
  }

  private logMockPublish(dto: any, errorMsg?: string) {
    const statusLine = errorMsg 
      ? `\x1b[31m[FAILED -> MOCK FALLBACK: ${errorMsg}]\x1b[0m` 
      : `\x1b[32m[MOCK PUBLISH ACCEPTED]\x1b[0m`;
      
    this.logger.debug(`
=========================================
🔥 KAFKA GOVERNED EVENT ${statusLine}
-----------------------------------------
Topic:       tribe.${this.tribeId || 'pakiship'}.events
Service:     ${dto.sourceServiceId}
Event Type:  ${dto.eventType}
Key:         ${dto.key}
Timestamp:   ${dto.payload.occurredAt}
Payload:     ${JSON.stringify(dto.payload, null, 2)}
Metadata:    ${JSON.stringify(dto.metadata, null, 2)}
=========================================
`);
  }
}
