from setuptools import setup, find_packages

setup(
    name="clawaimail",
    version="0.1.0",
    description="ClawAIMail SDK - Email infrastructure for AI agents",
    long_description=open("README.md").read(),
    long_description_content_type="text/markdown",
    author="ClawAIMail",
    author_email="support@clawaimail.com",
    url="https://clawaimail.com",
    project_urls={
        "Documentation": "https://clawaimail.com/docs",
        "Source": "https://github.com/joansongjr/clawaimail",
    },
    packages=find_packages(),
    python_requires=">=3.7",
    keywords=["email", "ai", "agent", "api", "clawaimail", "mcp", "claude"],
    classifiers=[
        "Development Status :: 3 - Alpha",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Topic :: Communications :: Email",
    ],
)
