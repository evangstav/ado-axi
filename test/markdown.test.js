import assert from "node:assert/strict";
import test from "node:test";
import { renderDescriptionHtml } from "../dist/src/markdown.js";

test("ATX heading renders to a bold line", () => {
  assert.equal(renderDescriptionHtml("# Title"), "<b>Title</b>");
  assert.equal(renderDescriptionHtml("### Deep"), "<b>Deep</b>");
});

test("single paragraph with a newline joins lines with <br>", () => {
  assert.equal(renderDescriptionHtml("line one\nline two"), "<div>line one<br>line two</div>");
});

test("blank lines separate paragraphs into distinct divs", () => {
  assert.equal(renderDescriptionHtml("para one\n\npara two"), "<div>para one</div><div>para two</div>");
});

test("unordered lists support -, * and + markers", () => {
  assert.equal(renderDescriptionHtml("- a\n- b"), "<ul><li>a</li><li>b</li></ul>");
  assert.equal(renderDescriptionHtml("* a\n+ b"), "<ul><li>a</li><li>b</li></ul>");
});

test("ordered lists render to <ol>", () => {
  assert.equal(renderDescriptionHtml("1. first\n2. second"), "<ol><li>first</li><li>second</li></ol>");
});

test("inline code renders to <code> and is not further formatted", () => {
  assert.equal(renderDescriptionHtml("run `npm **test**`"), "<div>run <code>npm **test**</code></div>");
});

test("bold and italic markers render", () => {
  assert.equal(renderDescriptionHtml("**b** and *i* and _j_"), "<div><b>b</b> and <i>i</i> and <i>j</i></div>");
});

test("intra-word underscores are not italicized", () => {
  assert.equal(renderDescriptionHtml("call my_var_name here"), "<div>call my_var_name here</div>");
  assert.equal(renderDescriptionHtml("path/to/file_name.txt"), "<div>path/to/file_name.txt</div>");
});

test("asterisks with surrounding whitespace are not italicized", () => {
  assert.equal(renderDescriptionHtml("compute 2 * 3 * 4"), "<div>compute 2 * 3 * 4</div>");
});

test("HTML special characters are escaped", () => {
  assert.equal(renderDescriptionHtml("a & b < c > d"), "<div>a &amp; b &lt; c &gt; d</div>");
});

test("plain prose with bare numbers is passed through unchanged", () => {
  // Regression: an earlier placeholder scheme could corrupt ' 2 ' in prose.
  assert.equal(renderDescriptionHtml("upgrade to version 2 today"), "<div>upgrade to version 2 today</div>");
});

test("empty and whitespace-only input render to an empty string", () => {
  assert.equal(renderDescriptionHtml(""), "");
  assert.equal(renderDescriptionHtml("   \n  \n"), "");
});

test("a combined document renders all block types in order", () => {
  const out = renderDescriptionHtml("# H\n\nintro line\n\n- one\n- two `c`\n\n1. a\n\n**done**");
  assert.equal(
    out,
    "<b>H</b><div>intro line</div><ul><li>one</li><li>two <code>c</code></li></ul><ol><li>a</li></ol><div><b>done</b></div>",
  );
});

test("CRLF line endings are normalized", () => {
  assert.equal(renderDescriptionHtml("a\r\n\r\nb"), "<div>a</div><div>b</div>");
});

test("escaping happens inside list items and headings too", () => {
  assert.equal(renderDescriptionHtml("# A & B"), "<b>A &amp; B</b>");
  assert.equal(renderDescriptionHtml("- x < y"), "<ul><li>x &lt; y</li></ul>");
});
