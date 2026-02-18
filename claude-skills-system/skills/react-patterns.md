---
skill: react-patterns
version: 1.0
tags: [react, javascript, frontend, hooks]
description: Modern React development patterns and best practices
author: Claude Skills System
updated: 2024-01-15
---

# React Patterns

## Overview
Modern React development patterns using functional components, hooks, and TypeScript.

## Key Concepts

### Component Structure
- Use functional components with hooks (no class components)
- One component per file
- Co-locate related files (component, styles, tests)

### File Organization
```
components/
  Button/
    Button.tsx          # Component
    Button.test.tsx     # Tests
    Button.module.css   # Styles
    index.ts           # Export
```

## Core Patterns

### Custom Hooks
Extract stateful logic into reusable hooks:

```typescript
// useDebounce.ts
import { useState, useEffect } from 'react';

export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
}
```

### Component Composition
Prefer composition over inheritance:

```typescript
interface CardProps {
  children: React.ReactNode;
  title?: string;
}

export function Card({ children, title }: CardProps) {
  return (
    <div className="card">
      {title && <h3 className="card-title">{title}</h3>}
      <div className="card-content">{children}</div>
    </div>
  );
}

// Usage
<Card title="User Profile">
  <UserDetails user={user} />
</Card>
```

### State Management
Use appropriate state solutions:

```typescript
// Local state for UI
const [isOpen, setIsOpen] = useState(false);

// Context for cross-component state
const ThemeContext = createContext<ThemeContextType>();

// External store for complex app state (Redux, Zustand, etc.)
```

### Error Boundaries
Implement error boundaries for graceful error handling:

```typescript
class ErrorBoundary extends Component<Props, State> {
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Error caught by boundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return <ErrorFallback error={this.state.error} />;
    }
    return this.props.children;
  }
}
```

### Performance Optimization
Use React performance features appropriately:

```typescript
// Memoize expensive computations
const expensiveValue = useMemo(() => {
  return computeExpensiveValue(a, b);
}, [a, b]);

// Memoize callbacks
const handleClick = useCallback(() => {
  doSomething(id);
}, [id]);

// Memoize components
const MemoizedComponent = React.memo(ExpensiveComponent);
```

## Common Pitfalls

1. **Overusing useEffect** - Many effects can be replaced with event handlers
2. **Missing dependency arrays** - Always include all dependencies
3. **Mutating state directly** - Always create new objects/arrays
4. **Using array index as key** - Use stable, unique IDs when possible

## Best Practices

- Keep components small and focused
- Extract custom hooks for reusable logic
- Use TypeScript for better type safety
- Write tests for critical paths
- Handle loading and error states
- Make components accessible (ARIA attributes)
- Use semantic HTML elements

## Testing Patterns

```typescript
import { render, screen, fireEvent } from '@testing-library/react';

test('Button calls onClick when clicked', () => {
  const handleClick = jest.fn();

  render(<Button onClick={handleClick}>Click me</Button>);

  fireEvent.click(screen.getByText('Click me'));

  expect(handleClick).toHaveBeenCalledTimes(1);
});
```

## Form Handling

Use controlled components with proper validation:

```typescript
interface FormData {
  email: string;
  password: string;
}

function LoginForm() {
  const [formData, setFormData] = useState<FormData>({
    email: '',
    password: ''
  });

  const [errors, setErrors] = useState<Partial<FormData>>({});

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();

    const newErrors = validateForm(formData);
    if (Object.keys(newErrors).length === 0) {
      // Submit form
    } else {
      setErrors(newErrors);
    }
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    // Clear error when user types
    if (errors[name as keyof FormData]) {
      setErrors(prev => ({ ...prev, [name]: undefined }));
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        name="email"
        value={formData.email}
        onChange={handleChange}
        aria-invalid={!!errors.email}
      />
      {errors.email && <span role="alert">{errors.email}</span>}
      {/* ... rest of form */}
    </form>
  );
}
```