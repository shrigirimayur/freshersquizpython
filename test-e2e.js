const puppeteer = require('puppeteer');
const { spawn } = require('child_process');

async function delay(time) {
  return new Promise(function(resolve) { 
      setTimeout(resolve, time)
  });
}

async function runTests() {
  console.log("Starting server for E2E tests...");
  const server = spawn('node', ['server.js'], {
    env: { ...process.env, PORT: "3010" },
    stdio: 'inherit'
  });

  await delay(2000); // Wait for server to start

  console.log("Launching Puppeteer...");
  const browser = await puppeteer.launch({
    headless: "new",
  });

  try {
    const orgPage = await browser.newPage();
    const partPage = await browser.newPage();

    // 1. Organizer Login
    console.log("Testing Organizer Login...");
    await orgPage.goto('http://localhost:3010/organizer.html');
    await orgPage.waitForSelector('#organizer-key');
    await orgPage.type('#organizer-key', 'code-battle-organizer');
    await orgPage.click('#authorize');
    
    await orgPage.waitForSelector('#start'); // Wait for dashboard to load
    console.log("Organizer dashboard loaded.");

    // 2. Participant Join
    console.log("Testing Participant Join...");
    await partPage.goto('http://localhost:3010/');
    await partPage.waitForSelector('#participant-name');
    await partPage.type('#participant-name', 'Test Student 123');
    await partPage.click('#join');

    await partPage.waitForSelector('.rule'); // Wait for waiting room
    console.log("Participant joined waiting room.");

    // 3. Organizer Start Test
    console.log("Organizer selecting student and starting test...");
    await orgPage.bringToFront();
    // Check the box for Test Student 123
    await orgPage.waitForSelector('input[data-name="Test Student 123"]');
    await orgPage.click('input[data-name="Test Student 123"]');
    await orgPage.click('#start');

    // 4. Participant Answering
    console.log("Participant taking the test...");
    await partPage.bringToFront();
    await partPage.waitForSelector('.option'); // Wait for question to render
    
    // Click first option
    const options = await partPage.$$('.option');
    await options[0].click();
    
    // Save and next
    await partPage.click('#save-next');
    await delay(1000);
    
    // Submit test
    console.log("Participant submitting test...");
    
    // Accept dialog
    partPage.on('dialog', async dialog => {
      await dialog.accept();
    });
    
    await partPage.click('#submit-test');
    
    await partPage.waitForSelector('.score', { timeout: 10000 }).catch(() => {});
    console.log("Participant submitted.");

    // 5. Organizer Check Leaderboard
    console.log("Organizer checking leaderboard...");
    await orgPage.bringToFront();
    await delay(3000); // wait for refresh
    const leaderboardText = await orgPage.$eval('#leaderboard-body', el => el.textContent);
    
    if (leaderboardText.includes('Test Student 123') && leaderboardText.includes('SUBMITTED')) {
      console.log("✅ ALL TESTS PASSED SUCCESSFULLY!");
    } else {
      console.error("❌ TEST FAILED: Student not found in leaderboard.");
      console.error("Leaderboard text:", leaderboardText);
    }

  } catch (err) {
    console.error("❌ TEST ENCOUNTERED AN ERROR:", err);
  } finally {
    console.log("Cleaning up...");
    await browser.close();
    server.kill();
  }
}

runTests();
