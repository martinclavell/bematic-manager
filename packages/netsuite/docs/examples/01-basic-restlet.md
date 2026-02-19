# Example: Basic RESTlet Calls

Complete examples of making RESTlet API calls with @bematic/netsuite.

## Prerequisites

```bash
npm install @bematic/netsuite
```

Environment variables:
```bash
NETSUITE_ENCRYPTION_KEY=<64-char-hex-string>
```

## Example 1: Simple GET Request

```typescript
import { NetSuiteClient } from '@bematic/netsuite';

// Create client
const client = NetSuiteClient.fromConfig({
  account: {
    accountId: '1234567',
    productionUrl: 'https://1234567.app.netsuite.com',
    environment: 'production',
  },
  credentials: {
    consumerKey: process.env.NETSUITE_CONSUMER_KEY!,
    consumerSecret: process.env.NETSUITE_CONSUMER_SECRET!,
    tokenId: process.env.NETSUITE_TOKEN_ID!,
    tokenSecret: process.env.NETSUITE_TOKEN_SECRET!,
  },
  restletUrl: process.env.NETSUITE_RESTLET_URL!,
});

// Make GET request
async function getCustomer(customerId: string) {
  try {
    const response = await client.restlet.get(
      client.config.restletUrl!,
      {
        action: 'getCustomer',
        customerId,
      }
    );

    console.log('Customer data:', response.data);
    console.log('Request duration:', response.durationMs, 'ms');
    console.log('Status code:', response.status);

    return response.data;
  } catch (error) {
    console.error('Failed to fetch customer:', error);
    throw error;
  }
}

// Usage
const customer = await getCustomer('1233');
console.log('Customer name:', customer.companyname);
```

## Example 2: POST Request with Body

```typescript
async function createSalesOrder(orderData: any) {
  const response = await client.restlet.post(
    client.config.restletUrl!,
    {
      action: 'createSalesOrder',
      data: orderData,
    }
  );

  console.log('Created order ID:', response.data.id);
  return response.data;
}

// Usage
const order = await createSalesOrder({
  entity: '1233', // Customer internal ID
  trandate: '2025-01-15',
  item: [
    {
      item: '456', // Item internal ID
      quantity: 2,
      rate: 99.99,
    },
  ],
});
```

## Example 3: Custom Headers

```typescript
async function getCustomerWithHeaders(customerId: string) {
  const response = await client.restlet.get(
    client.config.restletUrl!,
    { customerId },
    {
      headers: {
        'X-Custom-Header': 'my-value',
        'X-Request-ID': crypto.randomUUID(),
      },
    }
  );

  return response.data;
}
```

## Example 4: Custom Timeout

```typescript
async function getLargeDataset() {
  const response = await client.restlet.get(
    client.config.restletUrl!,
    { action: 'exportAllCustomers' },
    {
      timeout: 120000, // 2 minutes
    }
  );

  return response.data;
}
```

## Example 5: Retry Configuration

```typescript
async function getCustomerWithRetry(customerId: string) {
  const response = await client.restlet.get(
    client.config.restletUrl!,
    { customerId },
    {
      retry: {
        maxAttempts: 5,
        initialDelayMs: 2000,
      },
    }
  );

  return response.data;
}
```

## Example 6: Error Handling

```typescript
import {
  NetSuiteAuthError,
  NetSuiteAPIError,
  NetSuiteTimeoutError,
  NetSuiteRateLimitError,
} from '@bematic/netsuite/errors';

async function getCustomerSafely(customerId: string) {
  try {
    const response = await client.restlet.get(
      client.config.restletUrl!,
      { customerId }
    );
    return { success: true, data: response.data };
  } catch (error) {
    if (error instanceof NetSuiteAuthError) {
      console.error('Authentication failed. Check credentials.');
      // Maybe refresh token or re-authenticate
      return { success: false, error: 'auth_failed' };
    }

    if (error instanceof NetSuiteTimeoutError) {
      console.error('Request timed out after', error.details?.timeoutMs, 'ms');
      // Maybe retry with longer timeout
      return { success: false, error: 'timeout' };
    }

    if (error instanceof NetSuiteRateLimitError) {
      console.error('Rate limit hit. Retry after', error.details?.retryAfterMs, 'ms');
      // Wait and retry
      return { success: false, error: 'rate_limit' };
    }

    if (error instanceof NetSuiteAPIError) {
      console.error('API error:', error.statusCode, error.code);
      console.error('Details:', error.details);
      return { success: false, error: 'api_error', details: error.details };
    }

    // Unknown error
    console.error('Unknown error:', error);
    return { success: false, error: 'unknown' };
  }
}
```

## Example 7: Multiple Requests

```typescript
async function getMultipleCustomers(customerIds: string[]) {
  // Sequential
  const customersSeq = [];
  for (const id of customerIds) {
    const response = await client.restlet.get(
      client.config.restletUrl!,
      { customerId: id }
    );
    customersSeq.push(response.data);
  }

  // Parallel (faster)
  const customersPar = await Promise.all(
    customerIds.map(id =>
      client.restlet.get(client.config.restletUrl!, { customerId: id })
    )
  );

  return customersPar.map(r => r.data);
}
```

## Example 8: PUT Request (Update)

```typescript
async function updateCustomer(customerId: string, updates: any) {
  const response = await client.restlet.put(
    client.config.restletUrl!,
    {
      action: 'updateCustomer',
      customerId,
      data: updates,
    }
  );

  console.log('Customer updated successfully');
  return response.data;
}

// Usage
await updateCustomer('1233', {
  companyname: 'Updated Company Name',
  email: 'new-email@example.com',
});
```

## Example 9: DELETE Request

```typescript
async function deleteCustomer(customerId: string) {
  const response = await client.restlet.delete(
    client.config.restletUrl!,
    {
      headers: {
        'X-Custom-Header': `delete-customer-${customerId}`,
      },
    }
  );

  console.log('Customer deleted');
  return response.data;
}
```

## Example 10: Response Inspection

```typescript
async function inspectResponse(customerId: string) {
  const response = await client.restlet.get(
    client.config.restletUrl!,
    { customerId }
  );

  // Access response data
  console.log('Data:', response.data);

  // Access HTTP status
  console.log('Status:', response.status); // 200, 201, etc.

  // Access headers
  console.log('Headers:', response.headers);
  console.log('Content-Type:', response.headers['content-type']);

  // Access duration
  console.log('Duration:', response.durationMs, 'ms');

  // Type-safe data access
  interface Customer {
    internalid: string;
    companyname: string;
    email: string;
  }

  const customer: Customer = response.data;
  console.log('Customer email:', customer.email);
}
```

## Example 11: Environment Switching

```typescript
async function testInSandbox(customerId: string) {
  // Switch to sandbox
  client.switchEnvironment('sandbox');

  try {
    const response = await client.restlet.get(
      client.config.restletUrl!,
      { customerId }
    );
    console.log('Sandbox data:', response.data);
  } finally {
    // Always switch back to production
    client.switchEnvironment('production');
  }
}
```

## Example 12: Full CRUD Operations

```typescript
interface Customer {
  internalid?: string;
  companyname: string;
  email: string;
  phone?: string;
}

class CustomerAPI {
  constructor(private client: NetSuiteClient) {}

  async create(customer: Customer): Promise<Customer> {
    const response = await this.client.restlet.post(
      this.client.config.restletUrl!,
      { action: 'createCustomer', data: customer }
    );
    return response.data;
  }

  async read(customerId: string): Promise<Customer> {
    const response = await this.client.restlet.get(
      this.client.config.restletUrl!,
      { action: 'getCustomer', customerId }
    );
    return response.data;
  }

  async update(customerId: string, updates: Partial<Customer>): Promise<Customer> {
    const response = await this.client.restlet.put(
      this.client.config.restletUrl!,
      { action: 'updateCustomer', customerId, data: updates }
    );
    return response.data;
  }

  async delete(customerId: string): Promise<void> {
    await this.client.restlet.delete(
      this.client.config.restletUrl!
    );
  }

  async list(filters?: any): Promise<Customer[]> {
    const response = await this.client.restlet.get(
      this.client.config.restletUrl!,
      { action: 'listCustomers', filters }
    );
    return response.data;
  }
}

// Usage
const customerAPI = new CustomerAPI(client);

// Create
const newCustomer = await customerAPI.create({
  companyname: 'Acme Corp',
  email: 'contact@acme.com',
});

// Read
const customer = await customerAPI.read(newCustomer.internalid!);

// Update
await customerAPI.update(newCustomer.internalid!, {
  phone: '555-1234',
});

// List
const customers = await customerAPI.list({ companyname: 'Acme' });

// Delete
await customerAPI.delete(newCustomer.internalid!);
```

## Best Practices

1. **Always handle errors** - Use try/catch and check error types
2. **Set appropriate timeouts** - Long operations need longer timeouts
3. **Use retries for transient failures** - Network issues are common
4. **Log requests** - Include request ID for debugging
5. **Validate inputs** - Check parameters before making requests
6. **Use TypeScript** - Type your requests and responses
7. **Test with sandbox first** - Verify before production
8. **Monitor performance** - Track response times
9. **Handle rate limits** - Implement backoff when rate limited
10. **Secure credentials** - Never log or expose credentials

## Next Steps

- **[Record CRUD Operations](./02-record-crud.md)** - Higher-level record operations
- **[Error Handling Patterns](./07-error-handling.md)** - Advanced error handling
- **[TypeScript Advanced](./08-typescript-advanced.md)** - Type-safe usage

---

[← Back to Examples](../README.md#examples)
