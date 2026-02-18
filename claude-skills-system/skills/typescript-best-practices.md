---
skill: typescript-best-practices
version: 1.0
tags: [typescript, javascript, types, best-practices]
description: TypeScript best practices and advanced patterns
author: Claude Skills System
updated: 2024-01-15
---

# TypeScript Best Practices

## Overview
TypeScript best practices for writing maintainable, type-safe code with proper type inference and minimal type assertions.

## Core Principles

1. **Prefer Type Inference** - Let TypeScript infer types when possible
2. **Avoid `any`** - Use `unknown` for truly unknown types
3. **Be Explicit at Boundaries** - Type function parameters and return types
4. **Use Strict Mode** - Enable all strict compiler options

## Type Patterns

### Utility Types
Use built-in utility types effectively:

```typescript
// Partial - Make all properties optional
type UpdateUserInput = Partial<User>;

// Required - Make all properties required
type CompleteUser = Required<User>;

// Readonly - Make all properties readonly
type ImmutableUser = Readonly<User>;

// Pick - Select specific properties
type UserCredentials = Pick<User, 'email' | 'password'>;

// Omit - Exclude specific properties
type PublicUser = Omit<User, 'password'>;
```

### Discriminated Unions
Use for type-safe state handling:

```typescript
type LoadingState = {
  status: 'loading';
};

type SuccessState<T> = {
  status: 'success';
  data: T;
};

type ErrorState = {
  status: 'error';
  error: Error;
};

type AsyncState<T> = LoadingState | SuccessState<T> | ErrorState;

// Type-safe handling
function handleState<T>(state: AsyncState<T>) {
  switch (state.status) {
    case 'loading':
      return 'Loading...';
    case 'success':
      return state.data; // TypeScript knows data exists
    case 'error':
      return state.error.message; // TypeScript knows error exists
  }
}
```

### Type Guards
Create custom type guards for runtime type checking:

```typescript
interface Cat {
  type: 'cat';
  meow(): void;
}

interface Dog {
  type: 'dog';
  bark(): void;
}

type Animal = Cat | Dog;

// Type guard function
function isCat(animal: Animal): animal is Cat {
  return animal.type === 'cat';
}

// Usage
function handleAnimal(animal: Animal) {
  if (isCat(animal)) {
    animal.meow(); // TypeScript knows this is a Cat
  } else {
    animal.bark(); // TypeScript knows this is a Dog
  }
}
```

### Generic Constraints
Use generics with constraints for flexible, type-safe functions:

```typescript
// Basic generic with constraint
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}

// Generic with multiple constraints
interface Lengthwise {
  length: number;
}

function logLength<T extends Lengthwise>(arg: T): T {
  console.log(arg.length);
  return arg;
}

// Works with strings, arrays, or any object with length
logLength('hello');
logLength([1, 2, 3]);
logLength({ length: 10, value: 'test' });
```

### Template Literal Types
Use for string manipulation at type level:

```typescript
type EventName = 'click' | 'focus' | 'blur';
type EventHandler<T extends EventName> = `on${Capitalize<T>}`;

// EventHandler<'click'> = 'onClick'
// EventHandler<'focus'> = 'onFocus'

type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
type Endpoint = `api/${string}`;

type APIRoute = `${HTTPMethod} ${Endpoint}`;
// Valid: 'GET api/users', 'POST api/products'
```

## Function Patterns

### Function Overloading
Provide multiple function signatures:

```typescript
function createElement(tag: 'a'): HTMLAnchorElement;
function createElement(tag: 'canvas'): HTMLCanvasElement;
function createElement(tag: 'div'): HTMLDivElement;
function createElement(tag: string): HTMLElement;
function createElement(tag: string): HTMLElement {
  return document.createElement(tag);
}

// TypeScript knows the specific return type
const link = createElement('a'); // HTMLAnchorElement
const div = createElement('div'); // HTMLDivElement
```

### Const Assertions
Use for literal types and readonly values:

```typescript
// Without const assertion
const config1 = {
  endpoint: 'https://api.example.com',
  timeout: 3000
}; // type: { endpoint: string; timeout: number }

// With const assertion
const config2 = {
  endpoint: 'https://api.example.com',
  timeout: 3000
} as const; // type: { readonly endpoint: 'https://api.example.com'; readonly timeout: 3000 }

// Tuple with const assertion
const tuple = [1, 2] as const; // type: readonly [1, 2], not number[]
```

## Error Handling

### Result Type Pattern
Avoid throwing exceptions for expected errors:

```typescript
type Result<T, E = Error> =
  | { success: true; value: T }
  | { success: false; error: E };

async function fetchUser(id: string): Promise<Result<User>> {
  try {
    const user = await api.getUser(id);
    return { success: true, value: user };
  } catch (error) {
    return { success: false, error: error as Error };
  }
}

// Usage
const result = await fetchUser('123');
if (result.success) {
  console.log(result.value); // TypeScript knows value exists
} else {
  console.error(result.error); // TypeScript knows error exists
}
```

## Module Patterns

### Barrel Exports
Organize exports for better imports:

```typescript
// components/index.ts
export { Button } from './Button';
export { Card } from './Card';
export { Modal } from './Modal';

// Usage
import { Button, Card, Modal } from './components';
```

### Namespace for Constants
Group related constants:

```typescript
export namespace Colors {
  export const Primary = '#007bff' as const;
  export const Secondary = '#6c757d' as const;
  export const Success = '#28a745' as const;
}

export namespace Sizes {
  export const Small = 'sm' as const;
  export const Medium = 'md' as const;
  export const Large = 'lg' as const;
}

// Usage
const buttonColor = Colors.Primary;
const buttonSize = Sizes.Large;
```

## Configuration

### Recommended tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020", "DOM"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "moduleResolution": "node",
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

## Common Pitfalls

1. **Using `any` instead of `unknown`** - Use `unknown` for truly unknown types
2. **Not using strict mode** - Always enable strict compiler options
3. **Excessive type assertions** - Let TypeScript infer when possible
4. **Not handling all union cases** - Use exhaustive checks
5. **Ignoring compiler errors** - Fix errors, don't suppress them