# NetSuite SuiteScript 2.x API Reference

## Overview
SuiteScript 2.x is the modern scripting API for NetSuite, used for User Event Scripts, Suitelets, Scheduled Scripts, and Map/Reduce scripts.

## Module System

### AMD Module Pattern
```javascript
/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/search', 'N/log'], function(record, search, log) {

    function beforeSubmit(context) {
        // Your code here
    }

    return {
        beforeSubmit: beforeSubmit
    };
});
```

### Core Modules
- `N/record` - Record operations
- `N/search` - Searching records
- `N/log` - Logging
- `N/runtime` - Script runtime info
- `N/email` - Send emails
- `N/file` - File operations
- `N/https` - HTTP requests
- `N/crypto` - Encryption
- `N/format` - Data formatting
- `N/util` - Utilities

## Record Module

### Load Record
```javascript
const customerRecord = record.load({
    type: record.Type.CUSTOMER,
    id: 123,
    isDynamic: true  // Optional: dynamic mode
});
```

### Create Record
```javascript
const leadRecord = record.create({
    type: record.Type.LEAD,
    isDynamic: false
});

leadRecord.setValue({
    fieldId: 'companyname',
    value: 'Test Company'
});

const leadId = leadRecord.save({
    enableSourcing: true,
    ignoreMandatoryFields: false
});
```

### Transform Record
```javascript
const salesOrder = record.transform({
    fromType: record.Type.ESTIMATE,
    fromId: 123,
    toType: record.Type.SALES_ORDER,
    isDynamic: true
});
```

## Search Module

### Basic Search
```javascript
const customerSearch = search.create({
    type: search.Type.CUSTOMER,
    filters: [
        ['email', search.Operator.IS, 'test@example.com'],
        'AND',
        ['isinactive', search.Operator.IS, 'F']
    ],
    columns: [
        search.createColumn({name: 'internalid', label: 'ID'}),
        search.createColumn({name: 'entityid', label: 'Customer ID'}),
        search.createColumn({name: 'email', label: 'Email'})
    ]
});

const searchResult = customerSearch.run();
const results = searchResult.getRange({
    start: 0,
    end: 100
});

results.forEach(function(result) {
    const id = result.getValue({name: 'internalid'});
    const email = result.getValue({name: 'email'});
    log.debug('Customer Found', `ID: ${id}, Email: ${email}`);
});
```

### Search with Paging (Handle > 1000 results)
```javascript
const pagedData = customerSearch.runPaged({
    pageSize: 1000
});

pagedData.pageRanges.forEach(function(pageRange) {
    const page = pagedData.fetch({index: pageRange.index});

    page.data.forEach(function(result) {
        // Process each result
    });
});
```

### Search Operators
```javascript
search.Operator.IS              // Exact match
search.Operator.ISNOT           // Not equal
search.Operator.CONTAINS        // Contains text
search.Operator.DOESNOTCONTAIN  // Does not contain
search.Operator.STARTSWITH      // Starts with
search.Operator.ISEMPTY         // Is empty
search.Operator.ISNOTEMPTY      // Is not empty
search.Operator.GREATERTHAN     // Greater than
search.Operator.LESSTHAN        // Less than
search.Operator.BETWEEN         // Between (requires array)
search.Operator.ANYOF           // Any of (requires array)
```

## Sublist Operations

### Dynamic Mode (Preferred for complex operations)
```javascript
const rec = record.load({
    type: record.Type.SALES_ORDER,
    id: 123,
    isDynamic: true
});

// Add line
rec.selectNewLine({sublistId: 'item'});
rec.setCurrentSublistValue({
    sublistId: 'item',
    fieldId: 'item',
    value: 456
});
rec.setCurrentSublistValue({
    sublistId: 'item',
    fieldId: 'quantity',
    value: 10
});
rec.commitLine({sublistId: 'item'});

// Edit line
rec.selectLine({
    sublistId: 'item',
    line: 0
});
rec.setCurrentSublistValue({
    sublistId: 'item',
    fieldId: 'quantity',
    value: 20
});
rec.commitLine({sublistId: 'item'});
```

### Standard Mode
```javascript
const rec = record.load({
    type: record.Type.SALES_ORDER,
    id: 123,
    isDynamic: false
});

// Get value
const itemId = rec.getSublistValue({
    sublistId: 'item',
    fieldId: 'item',
    line: 0
});

// Set value
rec.setSublistValue({
    sublistId: 'item',
    fieldId: 'quantity',
    line: 0,
    value: 15
});

// Insert line
rec.insertLine({
    sublistId: 'item',
    line: 1
});

// Remove line
rec.removeLine({
    sublistId: 'item',
    line: 2
});
```

## Logging

```javascript
log.debug({
    title: 'Process Start',
    details: `Processing customer ID: ${customerId}`
});

log.audit({
    title: 'Process Complete',
    details: {
        customerId: customerId,
        recordsProcessed: count,
        duration: endTime - startTime
    }
});

log.error({
    title: 'Process Failed',
    details: error.toString()
});
```

## Error Handling

```javascript
try {
    const rec = record.load({
        type: record.Type.CUSTOMER,
        id: customerId
    });
} catch (e) {
    log.error({
        title: 'Failed to load customer',
        details: `Customer ID: ${customerId}, Error: ${e.message}`
    });
    throw e;
}
```

## Runtime Module

```javascript
const runtime = require('N/runtime');

const script = runtime.getCurrentScript();
const remainingUsage = script.getRemainingUsage();
const scriptId = script.id;
const deploymentId = script.deploymentId;

// Get script parameter
const customParam = script.getParameter({
    name: 'custscript_my_parameter'
});

// Get current user
const currentUser = runtime.getCurrentUser();
const userId = currentUser.id;
const userRole = currentUser.role;
const userEmail = currentUser.email;
```

## User Event Script Pattern

```javascript
/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/log', 'N/search'], function(record, log, search) {

    function beforeLoad(context) {
        if (context.type === context.UserEventType.CREATE) {
            // New record logic
        }
    }

    function beforeSubmit(context) {
        const newRecord = context.newRecord;
        const oldRecord = context.oldRecord;

        if (context.type === context.UserEventType.CREATE ||
            context.type === context.UserEventType.EDIT) {

            // Validation logic
            const email = newRecord.getValue({fieldId: 'email'});
            if (!email) {
                throw new Error('Email is required');
            }
        }
    }

    function afterSubmit(context) {
        if (context.type === context.UserEventType.CREATE) {
            log.audit('Customer Created', context.newRecord.id);
        }
    }

    return {
        beforeLoad: beforeLoad,
        beforeSubmit: beforeSubmit,
        afterSubmit: afterSubmit
    };
});
```

## Suitelet Pattern

```javascript
/**
 * @NApiVersion 2.x
 * @NScriptType Suitelet
 */
define(['N/ui/serverWidget', 'N/record', 'N/log'],
function(serverWidget, record, log) {

    function onRequest(context) {
        if (context.request.method === 'GET') {
            // Create form
            const form = serverWidget.createForm({
                title: 'Custom Form'
            });

            form.addField({
                id: 'custpage_customer',
                type: serverWidget.FieldType.SELECT,
                label: 'Customer',
                source: 'customer'
            });

            form.addSubmitButton({
                label: 'Submit'
            });

            context.response.writePage(form);

        } else {
            // POST - process form
            const customerId = context.request.parameters.custpage_customer;

            // Process the data
            log.debug('Form Submitted', `Customer ID: ${customerId}`);

            // Redirect or show result
            context.response.write('Success!');
        }
    }

    return {
        onRequest: onRequest
    };
});
```

## Best Practices

1. **Use Dynamic Mode** for complex sublist operations
2. **Check Governance** in long-running scripts
3. **Use Search API** instead of loading records when possible
4. **Batch Operations** to minimize API calls
5. **Log Strategically** - Use appropriate log levels
6. **Handle Errors** gracefully with try-catch
7. **Use Script Parameters** for configuration
8. **Validate Data** in beforeSubmit, not afterSubmit

## Key Differences from SuiteScript 1.0

1. **Module-based** - Explicit imports required
2. **0-based indexes** - Sublists start at 0
3. **Numeric IDs** - Record IDs are numbers
4. **Promise support** - Some operations support promises
5. **Object parameters** - Methods use object notation
6. **Type safety** - Built-in enums for types/operators