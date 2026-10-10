import assert from "node:assert/strict";
import { chooseCheckoutProvider } from "./checkout-provider.ts";
assert.equal(chooseCheckoutProvider(true,true),"square");
assert.equal(chooseCheckoutProvider(false,true),"paypal");
assert.equal(chooseCheckoutProvider(true,true,"paypal"),"paypal");
assert.equal(chooseCheckoutProvider(false,true,"square"),"square");
assert.throws(()=>chooseCheckoutProvider(false,false));
assert.throws(()=>chooseCheckoutProvider(true,true,"stripe"));
assert.throws(()=>chooseCheckoutProvider(true,true,"unknown"));
