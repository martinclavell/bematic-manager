# NetSuite SuiteScript 1.0 API Reference

## Overview
SuiteScript 1.0 is the legacy scripting API for NetSuite. While newer scripts should use 2.x, SSP Libraries in SuiteCommerce MUST use 1.0.

## Core Record APIs

### nlapiLoadRecord(type, id)
```javascript
var customer = nlapiLoadRecord('customer', 123);
var email = customer.getFieldValue('email');
var lineCount = customer.getLineItemCount('item');
```

### nlapiSubmitRecord(record, doSourcing, ignoreMandatoryFields)
```javascript
customer.setFieldValue('phone', '555-1234');
var id = nlapiSubmitRecord(customer, true, false);
```

### nlapiCreateRecord(type, initializeValues)
```javascript
var lead = nlapiCreateRecord('lead');
lead.setFieldValue('companyname', 'Test Company');
lead.setFieldValue('email', 'test@example.com');
var leadId = nlapiSubmitRecord(lead);
```

## Search APIs

### nlapiSearchRecord(type, id, filters, columns)
```javascript
var filters = [
    new nlobjSearchFilter('email', null, 'is', 'test@example.com'),
    new nlobjSearchFilter('isinactive', null, 'is', 'F')
];

var columns = [
    new nlobjSearchColumn('internalid'),
    new nlobjSearchColumn('firstname'),
    new nlobjSearchColumn('lastname')
];

var results = nlapiSearchRecord('customer', null, filters, columns);
if (results) {
    for (var i = 0; i < results.length; i++) {
        var id = results[i].getId();
        var firstName = results[i].getValue('firstname');
    }
}
```

### Search Operators
- `is`, `isnot` - Exact match
- `contains`, `doesnotcontain` - Text contains
- `startswith`, `doesnotstartwith` - Text starts with
- `isempty`, `isnotempty` - Field empty check
- `greaterthan`, `lessthan` - Numeric comparisons
- `between` - Range (requires array value)
- `anyof`, `noneof` - Multiple values (requires array)

## Logging

### nlapiLogExecution(type, title, details)
```javascript
nlapiLogExecution('DEBUG', 'Process Start', 'Processing customer ID: ' + customerId);
nlapiLogExecution('ERROR', 'Search Failed', JSON.stringify(error));
nlapiLogExecution('AUDIT', 'Process Complete', 'Processed ' + count + ' records');
```

Log Types:
- `DEBUG` - Detailed debugging info
- `AUDIT` - Important business events
- `ERROR` - Error conditions
- `EMERGENCY` - Critical failures

## Field APIs

### Getting Values
```javascript
var value = record.getFieldValue('fieldname');
var text = record.getFieldText('fieldname'); // For select fields
var values = record.getFieldValues('multiselect'); // Returns array
```

### Setting Values
```javascript
record.setFieldValue('fieldname', 'value');
record.setFieldText('fieldname', 'Display Text');
record.setFieldValues('multiselect', ['1', '2', '3']);
```

## Sublist APIs

### Reading Sublists
```javascript
var lineCount = record.getLineItemCount('item');
for (var i = 1; i <= lineCount; i++) {
    var itemId = record.getLineItemValue('item', 'item', i);
    var quantity = record.getLineItemValue('item', 'quantity', i);
}
```

### Modifying Sublists
```javascript
// Add new line
record.selectNewLineItem('item');
record.setCurrentLineItemValue('item', 'item', 123);
record.setCurrentLineItemValue('item', 'quantity', 5);
record.commitLineItem('item');

// Edit existing line
record.selectLineItem('item', 2);
record.setCurrentLineItemValue('item', 'quantity', 10);
record.commitLineItem('item');

// Remove line
record.removeLineItem('item', 3);
```

## Lookups (Performance Optimization)

### nlapiLookupField(type, id, fields, text)
```javascript
// Single field
var email = nlapiLookupField('customer', 123, 'email');

// Multiple fields
var values = nlapiLookupField('customer', 123, ['email', 'phone', 'companyname']);
// Returns: {email: 'test@example.com', phone: '555-1234', companyname: 'Test Corp'}

// Get display text for select field
var statusText = nlapiLookupField('customer', 123, 'entitystatus', true);
```

## Common Patterns

### Check if Record Exists
```javascript
function recordExists(type, filters) {
    var results = nlapiSearchRecord(type, null, filters);
    return !!(results && results.length > 0);
}

// Usage
var exists = recordExists('customer', [
    new nlobjSearchFilter('email', null, 'is', 'test@example.com')
]);
```

### Get All Search Results (Handle 1000 limit)
```javascript
function getAllSearchResults(type, filters, columns) {
    var allResults = [];
    var searchResults;
    var startIndex = 0;

    do {
        searchResults = nlapiSearchRecord(type, null, filters, columns);
        if (searchResults) {
            allResults = allResults.concat(searchResults);
            startIndex += 1000;

            if (searchResults.length === 1000) {
                // Add filter to get next batch
                filters.push(new nlobjSearchFilter('internalidnumber', null, 'greaterthan', searchResults[999].getId()));
            }
        }
    } while (searchResults && searchResults.length === 1000);

    return allResults;
}
```

### Error Handling
```javascript
try {
    var record = nlapiLoadRecord('customer', id);
    // Process record
} catch (e) {
    nlapiLogExecution('ERROR', 'Failed to load customer', 'ID: ' + id + ', Error: ' + e.toString());
    throw e; // Re-throw if needed
}
```

## Governance Limits

- **SSP Libraries**: 1,000 units per request
- **Usage Units**:
  - nlapiLoadRecord: 10 units
  - nlapiSubmitRecord: 20 units
  - nlapiSearchRecord: 10 units
  - nlapiLookupField: 1 unit

### Check Remaining Units
```javascript
var remaining = nlapiGetContext().getRemainingUsage();
if (remaining < 100) {
    nlapiLogExecution('AUDIT', 'Low Governance', 'Only ' + remaining + ' units remaining');
}
```

## Important Differences from SuiteScript 2.x

1. **No Modules** - All APIs are global
2. **1-based indexes** - Sublists start at 1, not 0
3. **String IDs** - Record IDs are strings, not numbers
4. **No Promises** - All operations are synchronous
5. **Different search syntax** - Uses filter/column objects

## Best Practices

1. **Always check search results** - Could be null
2. **Use lookupField for single values** - More efficient than loadRecord
3. **Batch operations** - Minimize API calls
4. **Log strategically** - Governance limits apply to logging too
5. **Handle errors gracefully** - Network/permission issues common