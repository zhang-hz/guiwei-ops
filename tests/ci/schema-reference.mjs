import assert from 'node:assert/strict';

// 只支持这两份冻结schema实际使用的关键字；未知关键字使对照失败。
export function checkSchema(value, schema, root = schema) {
  const keywords = ['$schema', '$defs', '$ref', 'title', 'type', 'additionalProperties', 'required', 'properties', 'const', 'enum', 'pattern', 'minLength', 'maxLength', 'items', 'minItems', 'maxItems', 'uniqueItems', 'minimum', 'maximum'];
  for (const key of Object.keys(schema)) assert.ok(keywords.includes(key));
  if (schema.$ref) {
    assert.ok(schema.$ref.startsWith('#/$defs/'));
    return checkSchema(value, root.$defs[schema.$ref.slice(8)], root);
  }
  if (Object.hasOwn(schema, 'const')) assert.deepEqual(value, schema.const);
  if (schema.enum) assert.ok(schema.enum.includes(value));
  if (schema.type === 'object') {
    assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
    for (const key of schema.required ?? []) assert.ok(Object.hasOwn(value, key));
    for (const [key, child] of Object.entries(value)) {
      if (schema.additionalProperties === false) assert.ok(Object.hasOwn(schema.properties ?? {}, key));
      if (schema.properties?.[key]) checkSchema(child, schema.properties[key], root);
    }
  }
  if (schema.type === 'array') {
    assert.ok(Array.isArray(value));
    assert.ok(value.length >= (schema.minItems ?? 0) && value.length <= (schema.maxItems ?? Infinity));
    if (schema.uniqueItems) assert.equal(new Set(value.map(item => JSON.stringify(item))).size, value.length);
    value.forEach(item => checkSchema(item, schema.items, root));
  }
  if (schema.type === 'string') {
    assert.equal(typeof value, 'string');
    let characters = 0;
    for (const character of value) { assert.ok(character); characters++; }
    assert.ok(characters >= (schema.minLength ?? 0) && characters <= (schema.maxLength ?? Infinity));
    if (schema.pattern) assert.match(value, new RegExp(schema.pattern, 'u'));
  }
  if (schema.type === 'integer') {
    assert.ok(Number.isInteger(value) && value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity));
  }
}
