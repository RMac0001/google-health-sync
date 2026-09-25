import { Modal, Setting, type App } from "obsidian";

/** Single text-field prompt with a submit button. `validate` returns an error message or nothing. */
export class TextPromptModal extends Modal {
	private value = "";

	constructor(
		app: App,
		private readonly options: {
			title: string;
			description: string;
			placeholder: string;
			submitText: string;
			validate: (value: string) => string | void;
			onSubmit: (value: string) => void | Promise<void>;
		},
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, options } = this;
		this.setTitle(options.title);
		contentEl.createEl("p", { text: options.description });

		const error = contentEl.createDiv({ cls: "mod-warning" });
		const submit = async () => {
			const message = options.validate(this.value);
			if (message) {
				error.setText(message);
				return;
			}
			this.close();
			await options.onSubmit(this.value.trim());
		};

		new Setting(contentEl).addText((text) => {
			text.setPlaceholder(options.placeholder).onChange((value) => {
				this.value = value;
				error.setText("");
			});
			text.inputEl.addClass("google-health-sync-prompt-input");
			text.inputEl.addEventListener("keydown", (event) => {
				if (event.key === "Enter") void submit();
			});
			window.setTimeout(() => text.inputEl.focus(), 0);
		});
		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText(options.submitText)
				.setCta()
				.onClick(() => void submit()),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
