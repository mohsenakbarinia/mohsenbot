from __future__ import annotations

import asyncio
import logging

from aiogram import Bot, Dispatcher, F, Router
from aiogram.filters import CommandStart, Command
from aiogram.types import KeyboardButton, Message, ReplyKeyboardMarkup, WebAppInfo

from app.ai.orchestrator.orchestrator import AIOrchestrator
from app.config.settings import get_settings

router = Router()


def build_main_keyboard(lang: str = "fa", miniapp_url: str = "") -> ReplyKeyboardMarkup:
    if lang == "en":
        rows = [
            [KeyboardButton(text="💬 New Chat"), KeyboardButton(text="🎭 Select Personality")],
            [KeyboardButton(text="🧠 My Memory"), KeyboardButton(text="🎙 Live Voice")],
            [KeyboardButton(text="📁 Send File"), KeyboardButton(text="📊 Usage & Quota")],
            [KeyboardButton(text="⚙️ Settings"), KeyboardButton(text="❓ Help")],
        ]
    else:
        rows = [
            [KeyboardButton(text="💬 گفتگوی جدید"), KeyboardButton(text="🎭 انتخاب شخصیت")],
            [KeyboardButton(text="🧠 حافظه من"), KeyboardButton(text="🎙 گفتگوی صوتی")],
            [KeyboardButton(text="📁 ارسال فایل"), KeyboardButton(text="📊 میزان مصرف")],
            [KeyboardButton(text="⚙️ تنظیمات"), KeyboardButton(text="❓ راهنما")],
        ]
    if miniapp_url.startswith("https://"):
        rows[1][1] = KeyboardButton(
            text="🎙 گفتگوی صوتی" if lang != "en" else "🎙 Live Voice",
            web_app=WebAppInfo(url=miniapp_url),
        )
    return ReplyKeyboardMarkup(keyboard=rows, resize_keyboard=True)


@router.message(CommandStart())
async def handle_start(message: Message) -> None:
    settings = get_settings()
    lang = "en" if (message.from_user and (message.from_user.language_code or "").startswith("en")) else "fa"
    welcome = (
        "Welcome to NEXORA AI! Send text, images, PDFs, or voice notes."
        if lang == "en"
        else "به NEXORA AI خوش آمدید! می‌توانید متن، تصویر، فایل PDF یا پیام صوتی ارسال کنید."
    )
    await message.answer(welcome, reply_markup=build_main_keyboard(lang, settings.telegram_miniapp_url))


@router.message(Command("help"))
@router.message(F.text.in_({"❓ راهنما", "❓ Help"}))
async def handle_help(message: Message) -> None:
    lang = "en" if message.text == "❓ Help" else "fa"
    text = (
        "NEXORA AI supports Gemini multimodal chat, isolated long-term memory, custom personalities, and Live Voice."
        if lang == "en"
        else "دستیار NEXORA AI از گفتگو، تحلیل تصویر و PDF، ویس، حافظه بلندمدت اختصاصی، شخصیت‌های متنوع و مکالمه صوتی زنده پشتیبانی می‌کند."
    )
    await message.answer(text)


@router.message(F.text)
async def handle_text_message(message: Message) -> None:
    settings = get_settings()
    orchestrator = AIOrchestrator(settings)
    try:
        result = await orchestrator.process_chat(
            prompt=message.text or "",
            personality_prompt="Respond clearly, helpfully, and accurately in the user's language.",
        )
        await message.answer(result["text"])
    except Exception as exc:
        await message.answer(f"Service error: {exc}")


async def run_bot_polling() -> None:
    settings = get_settings()
    if not settings.telegram_bot_token:
        logging.warning("TELEGRAM_BOT_TOKEN is not set; Telegram bot polling skipped.")
        return
    bot = Bot(token=settings.telegram_bot_token)
    dp = Dispatcher()
    dp.include_router(router)
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(run_bot_polling())
