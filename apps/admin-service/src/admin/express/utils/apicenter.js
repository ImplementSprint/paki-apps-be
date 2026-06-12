'use strict';

/**
 * apicenter.js
 * ============
 * Centralized client for publishing governed Kafka events to APICenter.
 * Swallows errors and provides a beautiful logging fallback so failures never crash business logic.
 */

const gatewayUrl = process.env.APICENTER_URL;
const tribeId = process.env.APICENTER_TRIBE_ID;
const sourceServiceId = process.env.APICENTER_SERVICE_ID || 'pakipark-backend';
const secret = process.env.APICENTER_TRIBE_SECRET;

let client = null;
let isSdkAvailable = false;
let isConfigured = false;

// Initialize the APICenter SDK
async function initClient() {
  if (!gatewayUrl || !tribeId || !secret) {
    console.warn(
      '[APICenter] Configuration is incomplete in environment. Missing APICENTER_URL, APICENTER_TRIBE_ID, or APICENTER_TRIBE_SECRET.'
    );
    console.warn('[APICenter] Running in Mock/Development Event Logging mode.');
    return;
  }

  isConfigured = true;

  try {
    // Dynamic import to support clean runtime behavior if SDK is not present
    const sdkModule = require('@implementsprint/sdk');
    const TribeClient = sdkModule.TribeClient;
    
    if (TribeClient) {
      client = new TribeClient({
        gatewayUrl,
        tribeId,
        sourceServiceId,
        secret,
      });
      
      isSdkAvailable = true;
      console.log(`[APICenter] Successfully loaded @implementsprint/sdk. Authenticating with APICenter at ${gatewayUrl}...`);
      
      await client.authenticate();
      console.log('[APICenter] SDK Client successfully authenticated!');
    }
  } catch (err) {
    console.warn(
      `[APICenter] Could not load or authenticate @implementsprint/sdk: ${err.message}.`
    );
    console.warn('[APICenter] Event publishing will fall back to Mock/Development Event Logging.');
    isSdkAvailable = false;
  }
}

// Automatically trigger initialization
initClient().catch((err) => {
  console.warn('[APICenter] Initialization failed:', err.message);
});

/**
 * Publish a business event to tribe.<tribe_id>.events topic
 */
async function publishTribeEvent({ sourceServiceId: serviceOverride, key, eventType, payload, metadata }) {
  const occurredAt = payload.occurredAt || new Date().toISOString();
  const eventPayload = {
    ...payload,
    occurredAt,
  };

  const finalDto = {
    sourceServiceId: serviceOverride || sourceServiceId,
    key: String(key),
    eventType,
    payload: eventPayload,
    metadata: metadata || { schemaVersion: '1' },
  };

  if (isSdkAvailable && client) {
    try {
      console.log(`[APICenter] Publishing governed Kafka event '${eventType}' to APICenter...`);
      const result = await client.publishTribeEvent(finalDto);
      console.log(`[APICenter] Event published successfully:`, JSON.stringify(result));
      return result;
    } catch (err) {
      console.error(`[APICenter] Failed to publish event to APICenter: ${err.message}`);
      logMockPublish(finalDto, err.message);
      return { accepted: false, error: err.message };
    }
  } else {
    logMockPublish(finalDto);
    return {
      accepted: true,
      mock: true,
      topic: `tribe.${tribeId || 'pakiship'}.events`,
      eventType,
    };
  }
}

/**
 * Explicitly publish to a governed Kafka topic
 */
async function kafkaPublish({ topic, sourceServiceId: serviceOverride, key, eventType, payload, metadata }) {
  const occurredAt = payload.occurredAt || new Date().toISOString();
  const eventPayload = {
    ...payload,
    occurredAt,
  };

  const finalDto = {
    topic,
    sourceServiceId: serviceOverride || sourceServiceId,
    key: String(key),
    eventType,
    payload: eventPayload,
    metadata: metadata || { schemaVersion: '1' },
  };

  if (isSdkAvailable && client) {
    try {
      console.log(`[APICenter] Explicitly publishing event to Kafka topic '${topic}' via APICenter...`);
      const result = await client.kafkaPublish(finalDto);
      console.log(`[APICenter] Kafka event published successfully:`, JSON.stringify(result));
      return result;
    } catch (err) {
      console.error(`[APICenter] Failed to explicitly publish Kafka event: ${err.message}`);
      logMockPublish(finalDto, err.message);
      return { accepted: false, error: err.message };
    }
  } else {
    logMockPublish(finalDto);
    return {
      accepted: true,
      mock: true,
      topic,
      eventType,
    };
  }
}

function logMockPublish(dto, errorMsg) {
  const statusLine = errorMsg 
    ? `\x1b[31m[FAILED -> MOCK FALLBACK: ${errorMsg}]\x1b[0m` 
    : `\x1b[32m[MOCK PUBLISH ACCEPTED]\x1b[0m`;
    
  console.debug(`
=========================================
🔥 KAFKA GOVERNED EVENT ${statusLine}
-----------------------------------------
Topic:       tribe.${tribeId || 'pakiship'}.events
Service:     ${dto.sourceServiceId}
Event Type:  ${dto.eventType}
Key:         ${dto.key}
Timestamp:   ${dto.payload.occurredAt}
Payload:     ${JSON.stringify(dto.payload, null, 2)}
Metadata:    ${JSON.stringify(dto.metadata, null, 2)}
=========================================
`);
}

module.exports = {
  publishTribeEvent,
  kafkaPublish,
};
