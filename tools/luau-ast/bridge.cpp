// Built against Luau 0.741 (commit 421cc81) supplied with this project.
// The production binary is generated from the official Luau Ast/Parser sources.
#include <iostream>
#include <sstream>
#include "Luau/Common.h"
LUAU_FASTFLAGVARIABLE(LuauExperimentalIfLocalAnalysis)
#include "Luau/Allocator.h"
#include "Luau/AstJsonEncoder.h"
#include "Luau/Parser.h"
#include "Luau/ParseOptions.h"
int main()
{
    std::ios::sync_with_stdio(false);
    std::ostringstream ss;
    ss << std::cin.rdbuf();
    std::string source = ss.str();
    Luau::Allocator allocator;
    Luau::AstNameTable names(allocator);
    Luau::ParseOptions options;
    options.captureComments = false;
    options.allowDeclarationSyntax = true;
    Luau::ParseResult result = Luau::Parser::parse(source.data(), source.size(), names, allocator, std::move(options));
    if (!result.errors.empty())
    {
        for (const Luau::ParseError& error : result.errors)
            std::cerr << error.getMessage() << "\n";
        return 2;
    }
    std::cout << Luau::toJson(result.root) << "\n";
    return 0;
}
