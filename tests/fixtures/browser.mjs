// A browser launched for a test, while the rest of its setup runs: if that fails, there is no test
// yet to close it in its finally, so it closes here.
export async function setUp(browser, build) {
  try {
    return await build();
  } catch (err) {
    await browser.close();
    throw err;
  }
}
