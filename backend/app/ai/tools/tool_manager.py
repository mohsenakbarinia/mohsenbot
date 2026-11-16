from __future__ import annotations

import ast
import operator
from datetime import datetime, timezone
from typing import Any, Callable


_SAFE_OPS: dict[type[ast.AST], Callable[..., float]] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}


def evaluate_safe_math(expression: str) -> float:
    """Evaluate arithmetic strictly via AST whitelist without eval()."""
    tree = ast.parse(expression.strip(), mode="eval")

    def _eval(node: ast.AST) -> float:
        if isinstance(node, ast.Expression):
            return _eval(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return float(node.value)
        if isinstance(node, ast.BinOp) and type(node.op) in _SAFE_OPS:
            right = _eval(node.right)
            if isinstance(node.op, (ast.Div, ast.Mod)) and right == 0:
                raise ZeroDivisionError("Division by zero")
            return _SAFE_OPS[type(node.op)](_eval(node.left), right)
        if isinstance(node, ast.UnaryOp) and type(node.op) in _SAFE_OPS:
            return _SAFE_OPS[type(node.op)](_eval(node.operand))
        raise ValueError(f"Disallowed expression node: {type(node).__name__}")

    return _eval(tree)


class ToolManager:
    def __init__(self) -> None:
        self.enabled_tools: dict[str, bool] = {
            "calculator": True,
            "datetime": True,
            "memory_search": True,
            "user_profile": True,
            "translator": True,
            "text_summarizer": True,
            "document_analyzer": True,
            "image_analyzer": True,
            "web_search": True,
        }

    def execute(self, tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
        if not self.enabled_tools.get(tool_name, False):
            return {"status": "denied", "error": f"Tool {tool_name} is disabled"}

        if tool_name == "calculator":
            expr = str(args.get("expression", ""))
            return {"status": "success", "value": evaluate_safe_math(expr)}

        if tool_name == "datetime":
            now = datetime.now(timezone.utc)
            return {"status": "success", "iso": now.isoformat()}

        return {"status": "error", "error": f"Tool {tool_name} requires runtime context"}
