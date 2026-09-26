const chatMessages = document.getElementById("chatMessages");
const refreshButton = document.querySelector(".refresh-msg");
const usernameForm = document.getElementById("usernameForm");
const usernameInput = document.getElementById("usernameInput");
const usernameStatus = document.getElementById("usernameStatus");
const signedInStatus = document.getElementById("signedInStatus");
const chatForm = document.getElementById("chatForm");
const messageInput = document.getElementById("msgInput");
const sendButton = chatForm.querySelector("button[type='submit']");
const replyPreview = document.getElementById("replyPreview");
const replyPreviewText = document.getElementById("replyPreviewText");
const cancelReplyButton = document.getElementById("cancelReplyButton");
const formattingMenu = document.querySelector(".formatting-menu");
const messagesUrl = "https://697a6c7a0e6ff62c3c596009.mockapi.io/messages";
const usernameStorageKey = "mainChatUsername";
const maxChatMessages = 100;
let currentUsername = null;
let messagesById = new Map();
let replyTarget = null;
const markdownParser = window.markdownit?.({ html: false, linkify: true, breaks: true });

function addMarkdownDelimiter(delimiter, ruleName, tagName, className) {
	if (!markdownParser) {
		return;
	}

	markdownParser.inline.ruler.before("emphasis", ruleName, (state, silent) => {
		const start = state.pos;
		if (state.src.slice(start, start + delimiter.length) !== delimiter) {
			return false;
		}

		const end = state.src.indexOf(delimiter, start + delimiter.length);
		if (end <= start + delimiter.length) {
			return false;
		}

		if (!silent) {
			const token = state.push(ruleName, "", 0);
			token.content = state.src.slice(start + delimiter.length, end);
		}
		state.pos = end + delimiter.length;
		return true;
	});

	markdownParser.renderer.rules[ruleName] = (tokens, index) => {
		const content = markdownParser.renderInline(tokens[index].content);
		return `<${tagName} class="${className}">${content}</${tagName}>`;
	};
}

addMarkdownDelimiter("__", "discord_underline", "u", "markdown-underline");
addMarkdownDelimiter("||", "discord_spoiler", "span", "markdown-spoiler");

function renderMarkdown(text) {
	if (!markdownParser || !window.DOMPurify) {
		return null;
	}
	return window.DOMPurify.sanitize(markdownParser.render(text), {
		USE_PROFILES: { html: true }
	});
}

function formatSelection(format) {
	const formats = {
		bold: ["**", "**", "bold text"],
		italic: ["*", "*", "italic text"],
		underline: ["__", "__", "underlined text"],
		strike: ["~~", "~~", "strikethrough text"],
		spoiler: ["||", "||", "spoiler text"],
		"inline-code": ["`", "`", "code"],
		"code-block": ["```\n", "\n```", "code"],
		link: ["[", "](https://example.com)", "link text"]
	};
	const selectionStart = messageInput.selectionStart;
	const selectionEnd = messageInput.selectionEnd;
	const selectedText = messageInput.value.slice(selectionStart, selectionEnd);

	if (format === "quote") {
		const content = selectedText || "quoted text";
		const quotedText = content.split("\n").map(line => `> ${line}`).join("\n");
		messageInput.setRangeText(quotedText, selectionStart, selectionEnd, "end");
		if (!selectedText) {
			messageInput.setSelectionRange(selectionStart + 2, selectionStart + quotedText.length);
		}
	} else {
		const [prefix, suffix, placeholder] = formats[format];
		const content = selectedText || placeholder;
		const formattedText = `${prefix}${content}${suffix}`;
		messageInput.setRangeText(formattedText, selectionStart, selectionEnd, "end");
		if (!selectedText) {
			messageInput.setSelectionRange(selectionStart + prefix.length, selectionStart + prefix.length + content.length);
		}
	}

	messageInput.dispatchEvent(new Event("input", { bubbles: true }));
	messageInput.focus();
	formattingMenu.open = false;
}

formattingMenu.addEventListener("click", event => {
	if (!(event.target instanceof Element)) {
		return;
	}
	const button = event.target.closest("button[data-format]");
	if (button) {
		formatSelection(button.dataset.format);
	}
});

function setSignedIn(username) {
	currentUsername = username;
	usernameForm.hidden = true;
	signedInStatus.hidden = false;
	signedInStatus.textContent = `Signed in as ${username}`;
	messageInput.disabled = false;
	sendButton.disabled = false;
	messageInput.placeholder = "Type a message...";
}

async function fetchMessages() {
	const response = await fetch(messagesUrl);
	if (!response.ok) {
		throw new Error(`HTTP error! Status: ${response.status}`);
	}
	const data = await response.json();
	if (!Array.isArray(data)) {
		throw new Error("The messages response was not a list.");
	}
	return data;
}

async function makeRoomInCollection() {
	const data = await fetchMessages();
	let storedCount = data.length;
	const messages = data.filter(item => !item.usernameClaim);

	for (const oldestMessage of messages) {
		if (storedCount < maxChatMessages) {
			break;
		}
		if (oldestMessage.id == null) {
			throw new Error("Could not identify the oldest message to remove.");
		}

		const response = await fetch(`${messagesUrl}/${encodeURIComponent(oldestMessage.id)}`, {
			method: "DELETE"
		});
		if (!response.ok) {
			const details = await response.text();
			throw new Error(`Could not remove the oldest message (HTTP ${response.status}). ${details}`.trim());
		}
		storedCount -= 1;
	}

	if (storedCount >= maxChatMessages) {
		throw new Error("The message collection is full, but no chat message could be removed.");
	}
}

function normalizedUsername(username) {
	return username.trim().toLocaleLowerCase();
}

function usernameIsTaken(data, username) {
	const normalized = normalizedUsername(username);
	return data.some(item => normalizedUsername(String(item.user ?? "")) === normalized);
}

async function claimUsername(username) {
	const data = await fetchMessages();
	if (usernameIsTaken(data, username)) {
		throw new Error("That username is already taken. Choose another one.");
	}

	await makeRoomInCollection();
	const response = await fetch(messagesUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ user: username, message: "", usernameClaim: true })
	});
	if (!response.ok) {
		const details = await response.text();
		throw new Error(`Could not register that username (HTTP ${response.status}). ${details}`.trim());
	}
	localStorage.setItem(usernameStorageKey, username);
	setSignedIn(username);
}

function showMessageStatus(text) {
	const status = document.createElement("div");
	status.className = "message received";
	status.textContent = text;
	chatMessages.append(status);
}

function setReplyTarget(item) {
	replyTarget = {
		id: String(item.id),
		user: String(item.user ?? "Unknown user"),
		message: String(item.message ?? "")
	};
	replyPreviewText.textContent = `Replying to ${replyTarget.user}: ${replyTarget.message.slice(0, 80)}`;
	replyPreview.hidden = false;
	messageInput.focus();
}

function clearReplyTarget() {
	replyTarget = null;
	replyPreview.hidden = true;
	replyPreviewText.textContent = "";
}

async function getMessages() {
	refreshButton.disabled = true;
	chatMessages.setAttribute("aria-busy", "true");

	if (chatMessages.children.length === 0) {
		showMessageStatus("Loading messages...");
	}

	try {
		const data = await fetchMessages();
		const visibleMessages = data.filter(item => !item.usernameClaim);
		messagesById = new Map(visibleMessages
			.filter(item => item.id != null)
			.map(item => [String(item.id), item]));

		chatMessages.replaceChildren();

		if (visibleMessages.length === 0) {
			showMessageStatus("No messages yet.");
			return;
		}

		let currentGroup = null;
		let currentGroupUsername = null;
		visibleMessages.forEach(item => {
			const itemUsername = String(item.user ?? "Unknown user");
			const normalizedItemUsername = normalizedUsername(itemUsername);
			if (!currentGroup || normalizedItemUsername !== currentGroupUsername) {
				currentGroup = document.createElement("div");
				currentGroup.className = "message-group";
				if (currentUsername && normalizedItemUsername === normalizedUsername(currentUsername)) {
					currentGroup.classList.add("sent");
				}
				currentGroupUsername = normalizedItemUsername;

				const username = document.createElement("div");
				username.className = "label username";
				username.textContent = itemUsername;
				currentGroup.append(username);
				chatMessages.append(currentGroup);
			}

			const message = document.createElement("div");
			message.className = currentGroup.classList.contains("sent") ? "message sent" : "message received";
			if (item.id != null) {
				message.dataset.messageId = String(item.id);
			}

			const originalMessage = item.replyTo == null ? null : messagesById.get(String(item.replyTo));
			if (item.replyTo != null) {
				const replyQuote = document.createElement(originalMessage ? "button" : "div");
				replyQuote.className = "message-reply-quote";
				if (originalMessage) {
					replyQuote.type = "button";
					replyQuote.dataset.targetMessage = String(originalMessage.id);
					replyQuote.textContent = `${originalMessage.user ?? "Unknown user"}: ${String(originalMessage.message ?? "").slice(0, 80)}`;
				} else {
					replyQuote.textContent = "Original message unavailable";
				}
				message.append(replyQuote);
			}

			const messageText = document.createElement("div");
			messageText.className = "message-text";
			const messageContent = String(item.message ?? "");
			const renderedMarkdown = renderMarkdown(messageContent);
			if (renderedMarkdown === null) {
				messageText.textContent = messageContent;
			} else {
				messageText.innerHTML = renderedMarkdown;
			}
			message.append(messageText);

			if (item.id != null) {
				const replyButton = document.createElement("button");
				replyButton.type = "button";
				replyButton.className = "reply-message-button";
				replyButton.dataset.replyId = String(item.id);
				replyButton.setAttribute("aria-label", "Reply to this message");
				replyButton.title = "Reply";

				const replyIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
				replyIcon.classList.add("reply-icon");
				replyIcon.setAttribute("viewBox", "0 0 24 24");
				replyIcon.setAttribute("aria-hidden", "true");
				const replyPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
				replyPath.setAttribute("d", "M9 17l-5-5 5-5M20 18v-2a4 4 0 0 0-4-4H4");
				replyPath.setAttribute("fill", "none");
				replyPath.setAttribute("stroke", "currentColor");
				replyPath.setAttribute("stroke-linecap", "round");
				replyPath.setAttribute("stroke-linejoin", "round");
				replyPath.setAttribute("stroke-width", "2");
				replyIcon.append(replyPath);
				replyButton.append(replyIcon);
				message.append(replyButton);
			}

			currentGroup.append(message);
		});
		chatMessages.scrollTop = chatMessages.scrollHeight;
	} catch (error) {
		console.error("Fetch error:", error);
		if (chatMessages.children.length === 0 || chatMessages.firstElementChild.textContent === "Loading messages...") {
			chatMessages.replaceChildren();
		}
		showMessageStatus("Could not load messages. Try again.");
	} finally {
		refreshButton.disabled = false;
		chatMessages.removeAttribute("aria-busy");
	}
}

usernameForm.addEventListener("submit", async event => {
	event.preventDefault();
	const username = usernameInput.value.trim();
	if (!username) {
		return;
	}

	const submitButton = usernameForm.querySelector("button[type='submit']");
	submitButton.disabled = true;
	usernameStatus.textContent = "Checking username...";
	try {
		await claimUsername(username);
		usernameStatus.textContent = "";
		getMessages();
	} catch (error) {
		usernameStatus.textContent = error.message || "Could not register. Try again.";
	} finally {
		submitButton.disabled = false;
	}
});

chatMessages.addEventListener("click", event => {
	if (!(event.target instanceof Element)) {
		return;
	}
	const spoiler = event.target.closest(".markdown-spoiler");
	if (spoiler) {
		spoiler.classList.toggle("revealed");
		return;
	}

	const replyButton = event.target.closest(".reply-message-button");
	if (replyButton) {
		const item = messagesById.get(replyButton.dataset.replyId);
		if (item) {
			setReplyTarget(item);
		}
		return;
	}

	const quote = event.target.closest("[data-target-message]");
	if (quote) {
		const targetId = quote.dataset.targetMessage;
		const target = [...chatMessages.querySelectorAll("[data-message-id]")]
			.find(message => message.dataset.messageId === targetId);
		target?.scrollIntoView({ behavior: "smooth", block: "center" });
	}
});

cancelReplyButton.addEventListener("click", clearReplyTarget);

chatForm.addEventListener("submit", async event => {
	event.preventDefault();
	const message = messageInput.value.trim();
	if (!currentUsername || !message) {
		return;
	}

	sendButton.disabled = true;
	try {
		await makeRoomInCollection();
		const newMessage = { user: currentUsername, message };
		if (replyTarget) {
			newMessage.replyTo = replyTarget.id;
		}
		const response = await fetch(messagesUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(newMessage)
		});
		if (!response.ok) {
			const details = await response.text();
			throw new Error(`The API rejected your message (HTTP ${response.status}). ${details}`.trim());
		}
		messageInput.value = "";
		resizeMessageInput();
		clearReplyTarget();
		await getMessages();
	} catch (error) {
		console.error("Send error:", error);
		showMessageStatus(error.message || "Could not send your message. Try again.");
	} finally {
		sendButton.disabled = false;
	}
});

refreshButton.addEventListener("click", getMessages);

function resizeMessageInput() {
	messageInput.style.height = "auto";
	messageInput.style.height = `${Math.min(Math.max(messageInput.scrollHeight, 42), 120)}px`;
	messageInput.style.overflowY = messageInput.scrollHeight > 120 ? "auto" : "hidden";
}

messageInput.addEventListener("input", resizeMessageInput);
messageInput.addEventListener("keydown", event => {
	if (event.key !== "Enter") {
		return;
	}

	event.preventDefault();
	if (event.shiftKey) {
		messageInput.setRangeText("\n", messageInput.selectionStart, messageInput.selectionEnd, "end");
		messageInput.dispatchEvent(new Event("input", { bubbles: true }));
	} else {
		chatForm.requestSubmit();
	}
});

const savedUsername = localStorage.getItem(usernameStorageKey);
if (savedUsername) {
	setSignedIn(savedUsername);
}

getMessages();
