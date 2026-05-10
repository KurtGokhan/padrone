import { describe, expect, test } from 'bun:test';
import { isReactElement } from 'padrone/ink';
import React from 'react';

describe('isReactElement', () => {
  test('returns true for JSX elements', () => {
    const el = React.createElement('div', null, 'hello');
    expect(isReactElement(el)).toBe(true);
  });

  test('returns true for component elements', () => {
    function Greeting() {
      return React.createElement('span', null, 'hi');
    }
    const el = React.createElement(Greeting);
    expect(isReactElement(el)).toBe(true);
  });

  test('returns false for null', () => {
    expect(isReactElement(null)).toBe(false);
  });

  test('returns false for undefined', () => {
    expect(isReactElement(undefined)).toBe(false);
  });

  test('returns false for strings', () => {
    expect(isReactElement('hello')).toBe(false);
  });

  test('returns false for numbers', () => {
    expect(isReactElement(42)).toBe(false);
  });

  test('returns false for plain objects', () => {
    expect(isReactElement({ type: 'div', props: {} })).toBe(false);
  });

  test('returns true for objects with $$typeof react.element symbol', () => {
    const fake = { $$typeof: Symbol.for('react.element'), type: 'div', props: {} };
    expect(isReactElement(fake)).toBe(true);
  });

  test('returns true for objects with $$typeof react.transitional.element symbol', () => {
    const fake = { $$typeof: Symbol.for('react.transitional.element'), type: 'div', props: {} };
    expect(isReactElement(fake)).toBe(true);
  });
});
